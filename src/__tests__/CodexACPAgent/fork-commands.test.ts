import {describe, expect, it, vi} from "vitest";
import {AgentMode} from "../../AgentMode";
import {setupPromptTestSession} from "../acp-test-utils";

const skill = (name: string, path = `/tmp/${name}/SKILL.md`, description = name) => ({
    name, description, path, scope: "user" as const, enabled: true,
});

describe("fork slash commands", () => {
    it("gives builtins case-insensitive precedence over colliding skills", async () => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession({
            fastModeEnabled: false, currentModelSupportsFast: true,
        });
        vi.spyOn(mockFixture.getCodexAppServerClient(), "listSkills").mockResolvedValue({
            data: [{cwd: "/workspace", skills: [skill("FAST")], errors: []}],
        });
        // @ts-expect-error exercising command publication policy
        await mockFixture.getCodexAcpAgent().availableCommands.publish(sessionState);
        const commands = mockFixture.getAcpConnectionEvents([])[0]!.args[0].update.availableCommands;
        expect(commands.filter((command: {name: string}) => command.name.toLowerCase() === "fast")).toHaveLength(1);

        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [{type: "text", text: "/$FAST"}]});
        expect(sessionState.fastModeEnabled).toBe(true);
        expect(turnStartSpy).not.toHaveBeenCalled();
    });

    it("publishes and invokes only the first duplicate skill", async () => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession();
        vi.spyOn(mockFixture.getCodexAppServerClient(), "listSkills").mockResolvedValue({data: [
            {cwd: "/workspace", skills: [skill("diagnose", "/tmp/first/SKILL.md", "First definition")], errors: []},
            {cwd: "/extra", skills: [skill("DIAGNOSE", "/tmp/second/SKILL.md", "Duplicate")], errors: []},
        ]});
        // @ts-expect-error exercising command publication policy
        await mockFixture.getCodexAcpAgent().availableCommands.publish(sessionState);
        const commands = mockFixture.getAcpConnectionEvents([])[0]!.args[0].update.availableCommands;
        expect(commands.filter((command: {name: string}) => command.name.toLowerCase() === "diagnose"))
            .toEqual([expect.objectContaining({name: "diagnose", description: "First definition", _meta: {codex: {commandKind: "skill"}}})]);

        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [{type: "text", text: "/DIAGNOSE investigate"}]});
        expect(turnStartSpy).toHaveBeenCalledWith(expect.objectContaining({input: [
            {type: "text", text: "$diagnose investigate", text_elements: []},
            {type: "skill", name: "diagnose", path: "/tmp/first/SKILL.md"},
        ]}));
    });

    it.each([
        ["unknown raw passthrough", "/unknown args", [], [{type: "text", text: "/unknown args", text_elements: []}]],
        ["empty cwd passthrough", "/diagnose args", [], [{type: "text", text: "/diagnose args", text_elements: []}], ""],
        ["structured skill", "/diagnose failing test", [skill("diagnose")], [
            {type: "text", text: "$diagnose failing test", text_elements: []},
            {type: "skill", name: "diagnose", path: "/tmp/diagnose/SKILL.md"},
        ]],
        ["/$ skill", "/$diagnose failing test", [skill("diagnose")], [
            {type: "text", text: "$diagnose failing test", text_elements: []},
            {type: "skill", name: "diagnose", path: "/tmp/diagnose/SKILL.md"},
        ]],
    ])("handles %s", async (_name, command, skills, expectedInput, cwd = "/workspace") => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession({cwd});
        vi.spyOn(mockFixture.getCodexAppServerClient(), "listSkills").mockResolvedValue(
            cwd ? {data: [{cwd, skills, errors: []}]} : {data: []},
        );
        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [{type: "text", text: command}]});
        expect(turnStartSpy).toHaveBeenCalledWith(expect.objectContaining({input: expectedInput}));
    });

    it("keeps attachments after structured skill input", async () => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession();
        vi.spyOn(mockFixture.getCodexAppServerClient(), "listSkills").mockResolvedValue({data: [{cwd: "/workspace", skills: [skill("diagnose")], errors: []}]});
        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [
            {type: "text", text: "/diagnose failing test"},
            {type: "resource_link", name: "report.txt", uri: "file:///tmp/report.txt"},
        ]});
        expect(turnStartSpy).toHaveBeenCalledWith(expect.objectContaining({input: expect.arrayContaining([
            {type: "skill", name: "diagnose", path: "/tmp/diagnose/SKILL.md"},
            {type: "text", text: "[@report.txt](file:///tmp/report.txt)", text_elements: []},
        ])}));
    });

    it.each([
        ["/fast", false, true, undefined], ["/fast off", true, false, undefined],
        ["/fast status", true, true, "Fast mode is on."],
        ["/fast quickly", false, false, 'Command "/fast" requires on|off|status.'],
    ])("handles %s locally", async (command, initial, expected, message) => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession({fastModeEnabled: initial, currentModelSupportsFast: true});
        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [{type: "text", text: command}]});
        expect(sessionState.fastModeEnabled).toBe(expected);
        expect(turnStartSpy).not.toHaveBeenCalled();
        const messages = mockFixture.getAcpConnectionEvents([]).filter(event => event.args[0]?.update?.sessionUpdate === "agent_message_chunk").map(event => event.args[0].update.content.text);
        expect(messages).toEqual(message ? [message] : []);
    });

    it.each([
        ["/auto-review", AgentMode.ReadOnly, AgentMode.Agent, undefined],
        ["/manual-review", AgentMode.Agent, AgentMode.ReadOnly, undefined],
        ["/auto-review now", AgentMode.ReadOnly, AgentMode.ReadOnly, 'Command "/auto-review" requires no arguments.'],
        ["/manual-review now", AgentMode.Agent, AgentMode.Agent, 'Command "/manual-review" requires no arguments.'],
    ])("handles %s locally", async (command, initial, expected, message) => {
        const {mockFixture, sessionState, turnStartSpy} = setupPromptTestSession({agentMode: initial});
        await mockFixture.getCodexAcpAgent().prompt({sessionId: sessionState.sessionId, prompt: [{type: "text", text: command}]});
        expect(sessionState.agentMode).toBe(expected);
        expect(turnStartSpy).not.toHaveBeenCalled();
        const text = mockFixture.getAcpConnectionEvents([]).find(event => event.args[0]?.update?.sessionUpdate === "agent_message_chunk")?.args[0].update.content.text;
        expect(text).toBe(message);
    });
});
