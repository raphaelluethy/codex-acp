import {createArrayDump, createCodexMockTestFixture} from "../acp-test-utils";

const FORK_COMMAND_NAMES = new Set(["fast", "auto-review", "manual-review"]);

export function createUpstreamCompatibleHistoryDump(
    fixture: ReturnType<typeof createCodexMockTestFixture>,
): string {
    const events = fixture.getAcpConnectionEvents([]);
    for (const event of events) {
        const update = event.args[0]?.update;
        if (update?.sessionUpdate !== "available_commands_update") {
            continue;
        }
        update.availableCommands = update.availableCommands
            .filter((command: {name: string}) => !FORK_COMMAND_NAMES.has(command.name))
            .map((command: {
                name: string;
                description: string;
                input: unknown;
                _meta?: {codex?: {commandKind?: string}; [key: string]: unknown};
            }) => {
                const {codex, ...upstreamMeta} = command._meta ?? {};
                const isSkill = codex?.commandKind === "skill";
                return {
                    ...command,
                    name: isSkill ? `$${command.name}` : command.name,
                    description: command.name === "plan" ? "Turn plan mode on." : command.description,
                    input: isSkill ? null : command.input,
                    ...(Object.keys(upstreamMeta).length > 0 ? {_meta: upstreamMeta} : {_meta: undefined}),
                };
            });
    }
    return createArrayDump(events, []);
}
