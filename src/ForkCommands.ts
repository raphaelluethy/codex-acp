import type {AvailableCommand} from "@agentclientprotocol/sdk";
import {AgentMode, MODE_CONFIG_ID} from "./AgentMode";
import {FAST_MODE_CONFIG_ID, FAST_MODE_OFF, FAST_MODE_ON} from "./FastModeConfig";
import {flattenSkills, normalizeSkillName} from "./Skills";
import type {SkillMetadata, SkillsListEntry} from "./app-server/v2";

export type ForkCommandContext = {
    fastModeEnabled: boolean;
    setConfigOption?: (configId: string, value: string) => Promise<void>;
    sendAgentText: (text: string) => Promise<void>;
    sendUsage: (name: string, inputHint: string) => Promise<void>;
};

const FORK_BUILTINS: AvailableCommand[] = [
    {
        name: "fast",
        description: "Toggle Fast mode to enable fastest inference when available.",
        input: { hint: "on|off|status" },
    },
    {
        name: "auto-review",
        description: "Route approval requests through auto review.",
        input: null,
    },
    {
        name: "manual-review",
        description: "Route approval requests to the user.",
        input: null,
    },
];

export function buildForkAvailableCommands(
    upstreamBuiltins: AvailableCommand[],
    skillsEntries: SkillsListEntry[],
): AvailableCommand[] {
    const commands = new Map<string, AvailableCommand>();
    const upstreamNames = new Set(upstreamBuiltins.map(command => normalizeSkillName(command.name)));
    const forkInsertionIndex = upstreamBuiltins.findIndex(command => command.name === "goal");
    const builtins = forkInsertionIndex < 0
        ? [...upstreamBuiltins, ...FORK_BUILTINS]
        : [
            ...upstreamBuiltins.slice(0, forkInsertionIndex),
            ...FORK_BUILTINS,
            ...upstreamBuiltins.slice(forkInsertionIndex),
        ];
    for (const command of builtins) {
        if (FORK_BUILTINS.includes(command) && upstreamNames.has(normalizeSkillName(command.name))) continue;
        const description = command.name === "plan"
            ? "Toggle Plan mode for the session."
            : command.description;
        commands.set(normalizeSkillName(command.name), {
            ...command,
            description,
            _meta: {...command._meta, codex: {commandKind: "builtin"}},
        });
    }
    for (const skill of flattenSkills(skillsEntries)) {
        const normalizedName = normalizeSkillName(skill.name);
        if (!skill.enabled || !isValidSlashCommandName(skill.name) || commands.has(normalizedName)) continue;
        commands.set(normalizedName, {
            name: skill.name,
            description: skillDescription(skill),
            input: {hint: "instructions"},
            _meta: {codex: {commandKind: "skill"}},
        });
    }
    return Array.from(commands.values());
}

export async function tryHandleForkCommand(
    name: string,
    rest: string,
    context: ForkCommandContext,
): Promise<{handled: boolean}> {
    switch (name) {
        case "fast": {
            const argument = rest.trim().toLowerCase();
            if (argument === "status") {
                await context.sendAgentText(`Fast mode is ${context.fastModeEnabled ? FAST_MODE_ON : FAST_MODE_OFF}.`);
                return {handled: true};
            }
            let enabled: boolean;
            if (argument.length === 0) enabled = !context.fastModeEnabled;
            else if (argument === FAST_MODE_ON) enabled = true;
            else if (argument === FAST_MODE_OFF) enabled = false;
            else {
                await context.sendUsage("fast", "on|off|status");
                return {handled: true};
            }
            return setConfigOption(context, FAST_MODE_CONFIG_ID, enabled ? FAST_MODE_ON : FAST_MODE_OFF);
        }
        case "auto-review":
            return setReviewMode(name, rest, context, AgentMode.Agent.id);
        case "manual-review":
            return setReviewMode(name, rest, context, AgentMode.ReadOnly.id);
        default:
            return {handled: false};
    }
}

async function setReviewMode(name: string, rest: string, context: ForkCommandContext, mode: string): Promise<{handled: boolean}> {
    if (rest.length > 0) {
        await context.sendUsage(name, "no arguments");
        return {handled: true};
    }
    return setConfigOption(context, MODE_CONFIG_ID, mode);
}

async function setConfigOption(context: ForkCommandContext, configId: string, value: string): Promise<{handled: boolean}> {
    await context.setConfigOption?.(configId, value);
    return {handled: context.setConfigOption !== undefined};
}

function isValidSlashCommandName(name: string): boolean {
    return name.length > 0 && !/[\s/]/.test(name);
}

function skillDescription(skill: SkillMetadata): string {
    return skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description;
}
