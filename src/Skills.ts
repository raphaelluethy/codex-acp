import type {SkillMetadata, SkillsListEntry} from "./app-server/v2";

export type SkillInvocation = {
    name: string;
    instructions: string;
};

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
