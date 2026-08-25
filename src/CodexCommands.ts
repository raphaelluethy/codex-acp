import type * as acp from "@agentclientprotocol/sdk";
import type {AvailableCommand} from "@agentclientprotocol/sdk";
import {ACPSessionConnection, type AcpClientConnection} from "./ACPSessionConnection";
import type {CodexAcpClient} from "./CodexAcpClient";
import {flattenSkills, normalizeSkillName, type SkillInvocation} from "./Skills";
import type {RateLimitSnapshot, ReviewTarget, SkillMetadata, SkillsListEntry, SkillsListParams, TurnCompletedNotification} from "./app-server/v2";
import type {SessionState} from "./CodexAcpServer";
import type {RateLimitsMap} from "./RateLimitsMap";
import type {TokenCount} from "./TokenCount";
import {logger} from "./Logger";
import {createAgentTextMessageChunk} from "./ContentChunks";
import {AgentMode, MODE_CONFIG_ID} from "./AgentMode";
import {FAST_MODE_CONFIG_ID, FAST_MODE_OFF, FAST_MODE_ON} from "./FastModeConfig";
import {
    COLLABORATION_MODE_CONFIG_ID,
    DEFAULT_COLLABORATION_MODE,
    PLAN_COLLABORATION_MODE,
} from "./CollaborationModeConfig";

type ParsedSlashCommand = {
    name: string;
    rest: string;
};

export type CommandHandleResult =
    | { handled: false, prompt?: never, skill?: never }
    | { handled: false, prompt: acp.ContentBlock[], skill?: never }
    | { handled: false, prompt?: never, skill: SkillInvocation }
    | { handled: true, turnCompleted?: TurnCompletedNotification };

export const GOAL_CONTINUATION_PROMPT: acp.ContentBlock[] = [{
    type: "text",
    text: "Continue working toward the active goal.",
}];

export type CommandHandleOptions = {
    onTurnStartPending?: () => void;
    onTurnStarted?: (turnId: string, threadId: string) => void;
    setConfigOption?: (configId: string, value: string) => Promise<void>;
};

export type LogoutHandler = () => void | Promise<void>;

export class CodexCommands {
    private readonly connection: AcpClientConnection;
    private readonly codexAcpClient: CodexAcpClient;
    private readonly runWithProcessCheck: <T>(operation: () => Promise<T>) => Promise<T>;
    private readonly onLogout: LogoutHandler;

    constructor(
        connection: AcpClientConnection,
        codexAcpClient: CodexAcpClient,
        runWithProcessCheck: <T>(operation: () => Promise<T>) => Promise<T>,
        onLogout: LogoutHandler = () => {}
    ) {
        this.connection = connection;
        this.codexAcpClient = codexAcpClient;
        this.runWithProcessCheck = runWithProcessCheck;
        this.onLogout = onLogout;
    }

    async publish(sessionState: SessionState, shouldPublish: () => boolean = () => true): Promise<void> {
        try {
            if (!shouldPublish()) {
                return;
            }
            const skillsResponse = await this.runWithProcessCheck(() => this.codexAcpClient.listSkills(this.createSkillsListParams(sessionState)));
            const availableCommands = this.buildAvailableCommands(skillsResponse?.data ?? []);
            if (availableCommands.length === 0 || !shouldPublish()) {
                return;
            }

            const session = new ACPSessionConnection(this.connection, sessionState.sessionId);
            await session.update({
                sessionUpdate: "available_commands_update",
                availableCommands
            });
        } catch (err) {
            if (shouldPublish()) {
                logger.error(`Failed to publish available commands for session ${sessionState.sessionId}`, err);
            }
        }
    }

    private createSkillsListParams(sessionState: SessionState): SkillsListParams {
        return {
            cwds: [sessionState.cwd, ...sessionState.additionalDirectories],
        };
    }

    private buildAvailableCommands(skillsEntries: SkillsListEntry[]): AvailableCommand[] {
        const commands = new Map<string, AvailableCommand>();

        for (const builtin of this.getBuiltinCommands()) {
            commands.set(normalizeSkillName(builtin.name), builtin);
        }

        for (const skill of flattenSkills(skillsEntries)) {
            const normalizedName = normalizeSkillName(skill.name);
            if (!skill.enabled || !isValidSlashCommandName(skill.name) || commands.has(normalizedName)) {
                continue;
            }
            commands.set(normalizedName, {
                name: skill.name,
                description: skillDescription(skill),
                input: { hint: "instructions" },
                _meta: { codex: { commandKind: "skill" } },
            });
        }
        return Array.from(commands.values());
    }

    /**
     * See the original cli commands documentation here: https://developers.openai.com/codex/cli/slash-commands/
     */
    private getBuiltinCommands(): AvailableCommand[] {
        const commands: AvailableCommand[] = [
            {
                name: "plan",
                description: "Toggle Plan mode for the session.",
                input: null,
                _meta: {
                    commandAction: {
                        kind: "setConfigOption",
                        configId: COLLABORATION_MODE_CONFIG_ID,
                        value: PLAN_COLLABORATION_MODE,
                        resetValue: DEFAULT_COLLABORATION_MODE,
                        presentation: "state",
                    },
                },
            },
            {
                name: "mcp",
                description: "List configured Model Context Protocol (MCP) tools.",
                input: null
            },
            {
                name: "skills",
                description: "List available skills.",
                input: null
            },
            {
                name: "status",
                description: "Display session configuration and token usage.",
                input: null
            },
            {
                name: "review",
                description: "Review uncommitted changes, or review with custom instructions.",
                input: { hint: "optional review instructions" }
            },
            {
                name: "review-branch",
                description: "Review changes relative to a base branch.",
                input: { hint: "branch name" }
            },
            {
                name: "review-commit",
                description: "Review a specific commit.",
                input: { hint: "commit sha" }
            },
            {
                name: "compact",
                description: "Summarize conversation to avoid hitting the context limit.",
                input: null
            },
            {
                name: "fast",
                description: "Toggle Fast mode to enable fastest inference when available.",
                input: { hint: "on|off|status" }
            },
            {
                name: "auto-review",
                description: "Route approval requests through auto review.",
                input: null
            },
            {
                name: "manual-review",
                description: "Route approval requests to the user.",
                input: null
            },
            {
                name: "goal",
                description: "Set a goal to keep pursuing.",
                input: { hint: "[<objective>|clear|pause|resume]" },
                _meta: {
                    commandAction: {
                        kind: "prefixPrompt",
                        presentation: "state",
                    },
                },
            },
            {
                name: "logout",
                description: "Sign out of Codex. This option is available when you are logged in via ChatGPT.",
                input: null
            }
        ];
        return commands.map(command => ({
            ...command,
            _meta: {
                ...command._meta,
                codex: { commandKind: "builtin" },
            },
        }));
    }

    private parseCommand(prompt: acp.ContentBlock[]): ParsedSlashCommand | null {
        const firstBlock = prompt[0];
        if (!firstBlock || firstBlock.type != "text") return null;

        const text = firstBlock.text.trim();
        if (!text.startsWith("/")) return null;

        const commandText = text.slice(1).trim();
        if (commandText.length === 0) return null;

        const [name] = commandText.split(/\s+/);
        if (!name) return null;

        return {
            name: name.toLowerCase(),
            rest: commandText.slice(name.length).trim(),
        };
    }

    async tryHandleCommand(
        prompt: acp.ContentBlock[],
        sessionState: SessionState,
        options: CommandHandleOptions = {},
    ): Promise<CommandHandleResult> {
        const command = this.parseCommand(prompt);
        if (command === null) return { handled: false };
        const commandName = command.name.startsWith("$") ? command.name.slice(1) : command.name;

        const sessionId = sessionState.sessionId;
        switch (commandName) {
            case "plan": {
                if (!await this.acceptsNoArguments(commandName, command.rest, sessionId)) {
                    return { handled: true };
                }
                const mode = sessionState.collaborationMode === PLAN_COLLABORATION_MODE
                    ? DEFAULT_COLLABORATION_MODE
                    : PLAN_COLLABORATION_MODE;
                return this.setConfigOptionCommand(options, COLLABORATION_MODE_CONFIG_ID, mode);
            }
            case "compact": {
                await this.runWithProcessCheck(() => this.codexAcpClient.runCompact(sessionId));
                return { handled: true };
            }
            case "fast": {
                return await this.runFastCommand(sessionState, command.rest, options);
            }
            case "auto-review": {
                if (!await this.acceptsNoArguments(commandName, command.rest, sessionId)) {
                    return { handled: true };
                }
                return await this.setConfigOptionCommand(options, MODE_CONFIG_ID, AgentMode.Agent.id);
            }
            case "manual-review": {
                if (!await this.acceptsNoArguments(commandName, command.rest, sessionId)) {
                    return { handled: true };
                }
                return await this.setConfigOptionCommand(options, MODE_CONFIG_ID, AgentMode.ReadOnly.id);
            }
            case "goal": {
                return await this.runGoalCommand(sessionState, command.rest, options);
            }
            case "review": {
                const target = this.buildReviewTarget(command.rest);
                const turnCompleted = await this.runReviewCommand(sessionState, target, options);
                return { handled: true, turnCompleted };
            }
            case "review-branch": {
                if (command.rest.length === 0) {
                    await this.sendCommandUsageMessage(commandName, "branch name", sessionId);
                    return { handled: true };
                }
                const turnCompleted = await this.runReviewCommand(sessionState, {
                    type: "baseBranch",
                    branch: command.rest,
                }, options);
                return { handled: true, turnCompleted };
            }
            case "review-commit": {
                if (command.rest.length === 0) {
                    await this.sendCommandUsageMessage(commandName, "commit sha", sessionId);
                    return { handled: true };
                }
                const turnCompleted = await this.runReviewCommand(sessionState, {
                    type: "commit",
                    sha: command.rest,
                    title: null,
                }, options);
                return { handled: true, turnCompleted };
            }
            case "status": {
                await this.sendAgentText(this.buildStatusMessage(sessionState), sessionId);
                return { handled: true };
            }
            case "logout": {
                await this.runWithProcessCheck(() => this.codexAcpClient.logout());
                await this.onLogout();
                await this.sendAgentText("Logged out from Codex account.", sessionId);
                return { handled: true };
            }
            case "skills": {
                const response = await this.runWithProcessCheck(() => this.codexAcpClient.listSkills(this.createSkillsListParams(sessionState)));
                const skills = flattenSkills(response?.data ?? []);
                const lines = skills.map(skill => {
                    const description = skillDescription(skill);
                    return description ? `- ${skill.name}: ${description}` : `- ${skill.name}`;
                });
                const text = lines.length > 0
                    ? ["Available skills:", ...lines].join("\n")
                    : "No skills configured.";
                await this.sendAgentText(text, sessionId);
                return { handled: true };
            }
            case "mcp": {
                const servers = await this.runWithProcessCheck(() => this.codexAcpClient.listMcpServers());
                const configuredServers = servers.data.map(server => {
                    const toolCount = Object.keys(server.tools ?? {}).length;
                    const resourceCount = (server.resources ?? []).length;
                    return `- ${server.name}: ${toolCount} tools, ${resourceCount} resources, auth=${server.authStatus}`;
                });
                const sessionServers = sessionState.sessionMcpServers
                    ? sessionState.sessionMcpServers.map(serverName => `- ${serverName}`)
                    : [];
                const lines = [...configuredServers, ...sessionServers];
                const text = lines.length > 0
                    ? ["Configured MCP servers:", ...lines].join("\n")
                    : "No MCP servers configured.";
                await this.sendAgentText(text, sessionId);
                return { handled: true };
            }
            default: {
                if (!isValidSlashCommandName(commandName)) {
                    return { handled: false };
                }
                return {
                    handled: false,
                    skill: { name: commandName, instructions: command.rest },
                };
            }
        }
    }

    private async setConfigOptionCommand(
        options: CommandHandleOptions,
        configId: string,
        value: string,
    ): Promise<CommandHandleResult> {
        await options.setConfigOption?.(configId, value);
        if (options.setConfigOption === undefined) {
            return { handled: false };
        }
        return { handled: true };
    }

    private async runFastCommand(
        sessionState: SessionState,
        rest: string,
        options: CommandHandleOptions,
    ): Promise<CommandHandleResult> {
        const argument = rest.trim().toLowerCase();
        if (argument === "status") {
            const state = sessionState.fastModeEnabled ? FAST_MODE_ON : FAST_MODE_OFF;
            await this.sendAgentText(`Fast mode is ${state}.`, sessionState.sessionId);
            return { handled: true };
        }

        let enabled: boolean;
        if (argument.length === 0) {
            enabled = !sessionState.fastModeEnabled;
        } else if (argument === FAST_MODE_ON) {
            enabled = true;
        } else if (argument === FAST_MODE_OFF) {
            enabled = false;
        } else {
            await this.sendCommandUsageMessage("fast", "on|off|status", sessionState.sessionId);
            return { handled: true };
        }

        return this.setConfigOptionCommand(
            options,
            FAST_MODE_CONFIG_ID,
            enabled ? FAST_MODE_ON : FAST_MODE_OFF,
        );
    }

    private async sendAgentText(text: string, sessionId: string): Promise<void> {
        const session = new ACPSessionConnection(this.connection, sessionId);
        await session.update(createAgentTextMessageChunk(text));
    }

    private async runReviewCommand(
        sessionState: SessionState,
        target: ReviewTarget,
        options: CommandHandleOptions,
    ): Promise<TurnCompletedNotification> {
        options.onTurnStartPending?.();
        return await this.runWithProcessCheck(() => this.codexAcpClient.runReview(
            sessionState.sessionId,
            target,
            (turnId, threadId) => {
                this.handleCommandTurnStarted(sessionState, options, turnId, threadId);
            },
        ));
    }

    private async runGoalCommand(
        sessionState: SessionState,
        rest: string,
        options: CommandHandleOptions,
    ): Promise<CommandHandleResult> {
        const sessionId = sessionState.sessionId;
        const argument = rest.trim();
        if (argument.length === 0) {
            await this.sendCommandUsageMessage("goal", "[<objective>|clear|pause|resume]", sessionId);
            return { handled: true };
        }

        switch (argument.toLowerCase()) {
            case "pause":
                await this.runWithProcessCheck(() => this.codexAcpClient.setGoalStatus(sessionId, "paused"));
                return { handled: true };
            case "resume":
                options.onTurnStartPending?.();
                return this.createGoalCommandResult(await this.runWithProcessCheck(() => this.codexAcpClient.resumeGoal(
                    sessionId,
                    (turnId) => {
                        this.handleCommandTurnStarted(sessionState, options, turnId, sessionId);
                    },
                )));
            case "clear":
                await this.runWithProcessCheck(() => this.codexAcpClient.clearGoal(sessionId));
                return { handled: true };
        }

        if (argument.length > 4000) {
            await this.sendAgentText('Command "/goal" requires goal text of at most 4000 characters.', sessionId);
            return { handled: true };
        }

        options.onTurnStartPending?.();
        return this.createGoalCommandResult(await this.runWithProcessCheck(() => this.codexAcpClient.setGoal(
            sessionId,
            argument,
            (turnId) => {
                this.handleCommandTurnStarted(sessionState, options, turnId, sessionId);
            },
        )));
    }

    private handleCommandTurnStarted(
        sessionState: SessionState,
        options: CommandHandleOptions,
        turnId: string,
        threadId: string,
    ): void {
        if (options.onTurnStarted) {
            options.onTurnStarted(turnId, threadId);
        } else {
            sessionState.currentTurnId = turnId;
        }
    }

    private createGoalCommandResult(turnCompleted: TurnCompletedNotification | null): CommandHandleResult {
        if (turnCompleted === null) {
            return { handled: false, prompt: GOAL_CONTINUATION_PROMPT };
        }
        return {
            handled: true,
            turnCompleted,
        };
    }

    private buildReviewTarget(instructions: string): ReviewTarget {
        if (instructions.length === 0) {
            return { type: "uncommittedChanges" };
        }
        return {
            type: "custom",
            instructions,
        };
    }

    private async sendCommandUsageMessage(name: string, inputHint: string, sessionId: string): Promise<void> {
        await this.sendAgentText(`Command "/${name}" requires ${inputHint}.`, sessionId);
    }

    private async acceptsNoArguments(name: string, rest: string, sessionId: string): Promise<boolean> {
        if (rest.length === 0) {
            return true;
        }
        await this.sendCommandUsageMessage(name, "no arguments", sessionId);
        return false;
    }

    private buildStatusMessage(sessionState: SessionState): string {
        const agentMode = sessionState.agentMode;
        const accountText = this.formatAccountInfo(sessionState.account);
        const tokenUsageText = this.formatTokenUsage(sessionState.totalTokenUsage);
        const contextWindowText = this.formatContextWindow(
            sessionState.lastTokenUsage,
            sessionState.modelContextWindow
        );

        const lines = [
            `**Model:** ${sessionState.currentModelId}`,
            `**Directory:** ${sessionState.cwd}`,
            `**Approval:** ${agentMode.approvalPolicy}`,
            `**Sandbox:** ${agentMode.sandboxMode}`,
            `**Account:** ${accountText}`,
            `**Session:** \`${sessionState.sessionId}\``,
            ``,
            `**Token usage:** ${tokenUsageText}`,
            `**Context window:** ${contextWindowText}`,
            ...this.formatRateLimitLines(sessionState.rateLimits),
        ];

        return lines.join("  \n");
    }

    private formatAccountInfo(account: SessionState["account"]): string {
        if (!account) {
            return "not logged in";
        }
        if (account.type === "apiKey") {
            return "API key configured";
        }
        if (account.type === "chatgpt") {
            return `ChatGPT ${account.planType} (${account.email})`;
        }
        if (account.type === "amazonBedrock") {
            return "Amazon Bedrock";
        }
        return "unknown";
    }

    private formatTokenUsage(usage: TokenCount | null): string {
        if (!usage) {
            return "data not available yet";
        }
        const total = this.formatTokenCount(usage.totalTokens);
        const input = this.formatTokenCount(usage.inputTokens);
        const cachedInput = this.formatTokenCount(usage.cachedInputTokens);
        const output = this.formatTokenCount(usage.outputTokens);
        return `${total} total  (${input} input + ${cachedInput} cached input, ${output} output)`;
    }

    private formatContextWindow(usage: TokenCount | null, contextWindow: number | null): string {
        if (!usage || !contextWindow) {
            return "data not available yet";
        }
        const used = usage.totalTokens;
        const percentLeft = Math.round(((contextWindow - used) / contextWindow) * 100);
        const usedFormatted = this.formatTokenCount(used);
        const totalFormatted = this.formatTokenCount(contextWindow);
        return `${percentLeft}% left (${usedFormatted} used / ${totalFormatted})`;
    }

    private formatRateLimitLines(rateLimits: RateLimitsMap | null): string[] {
        if (!rateLimits || rateLimits.size === 0) {
            return [`**Limits:** data not available yet`];
        }

        const lines: string[] = [];

        for (const [, entry] of rateLimits) {
            lines.push(...this.formatSingleRateLimit(entry.limitName, entry.snapshot));
        }

        return lines.length > 0 ? lines : [`**Limits:** data not available yet`];
    }

    private formatSingleRateLimit(limitName: string, rateLimits: RateLimitSnapshot): string[] {
        const lines: string[] = [];
        const prefix = limitName ? `${limitName} ` : "";

        if (rateLimits.primary) {
            const percentLeft = Math.round(100 - rateLimits.primary.usedPercent);
            const resetText = this.formatResetTime(rateLimits.primary.resetsAt);
            const label = this.formatWindowLabel(rateLimits.primary.windowDurationMins);
            lines.push(`**${prefix}${label}:** ${percentLeft}% left${resetText}`);
        }

        if (rateLimits.secondary) {
            const percentLeft = Math.round(100 - rateLimits.secondary.usedPercent);
            const resetText = this.formatResetTime(rateLimits.secondary.resetsAt);
            const label = this.formatWindowLabel(rateLimits.secondary.windowDurationMins);
            lines.push(`**${prefix}${label}:** ${percentLeft}% left${resetText}`);
        }

        if (rateLimits.credits) {
            if (rateLimits.credits.unlimited) {
                lines.push(`**${prefix}Credits:** unlimited`);
            } else if (rateLimits.credits.balance) {
                lines.push(`**${prefix}Credits:** ${rateLimits.credits.balance}`);
            }
        }

        return lines;
    }

    private formatWindowLabel(windowDurationMins: number | null): string {
        if (windowDurationMins === null) {
            return "Limit";
        }
        if (windowDurationMins < 60) {
            return `${windowDurationMins}m limit`;
        }
        if (windowDurationMins < 1440) {
            const hours = Math.round(windowDurationMins / 60);
            return `${hours}h limit`;
        }
        if (windowDurationMins < 10080) {
            const days = Math.round(windowDurationMins / 1440);
            return `${days}d limit`;
        }
        return "Weekly limit";
    }

    private formatResetTime(resetsAt: number | null): string {
        if (resetsAt === null) {
            return "";
        }
        const resetDate = new Date(resetsAt * 1000);
        const now = new Date();
        const isToday = resetDate.toDateString() === now.toDateString();

        const timeStr = resetDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        if (isToday) {
            return ` (resets ${timeStr})`;
        }

        const dateStr = resetDate.toLocaleDateString([], { day: 'numeric', month: 'short' });
        return ` (resets ${timeStr} on ${dateStr})`;
    }

    private formatTokenCount(count: number): string {
        if (count >= 1000000) {
            return `${(count / 1000000).toFixed(1)}M`;
        }
        if (count >= 1000) {
            return `${(count / 1000).toFixed(1)}K`;
        }
        return count.toString();
    }
}

function isValidSlashCommandName(name: string): boolean {
    return name.length > 0 && !/[\s/]/.test(name);
}

function skillDescription(skill: SkillMetadata): string {
    return skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description;
}
