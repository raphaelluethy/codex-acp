import type {SkillMetadata, SkillsListEntry, UserInput} from "./app-server/v2";

export function flattenSkills(entries: SkillsListEntry[]): SkillMetadata[] {
    return entries.flatMap(entry => entry.skills);
}

export function normalizeSkillName(name: string): string {
    return name.toLowerCase();
}

export function findEnabledSkill(entries: SkillsListEntry[], requestedName: string): SkillMetadata | null {
    const normalizedName = normalizeSkillName(requestedName);
    return flattenSkills(entries)
        .find(skill => skill.enabled && normalizeSkillName(skill.name) === normalizedName) ?? null;
}

export function resolveSkillInput(text: string, entries: SkillsListEntry[]): UserInput[] | null {
    const commandText = text.trim();
    if (!commandText.startsWith("/")) {
        return null;
    }

    const invocation = commandText.slice(1).trim();
    const [rawName] = invocation.split(/\s+/);
    if (!rawName) {
        return null;
    }

    const requestedName = rawName.startsWith("$") ? rawName.slice(1) : rawName;
    if (!requestedName) {
        return null;
    }

    const skill = findEnabledSkill(entries, requestedName);
    if (skill === null) {
        return null;
    }

    const instructions = invocation.slice(rawName.length).trim();
    const canonicalText = instructions.length > 0
        ? `$${skill.name} ${instructions}`
        : `$${skill.name}`;
    return [
        {type: "text", text: canonicalText, text_elements: []},
        {type: "skill", name: skill.name, path: skill.path},
    ];
}
