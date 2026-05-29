import * as crypto from 'crypto';
import * as fs from 'fs';
import type { Tool, ToolDeclaration, ToolResult, ToolRegistration } from '../types';
import { getSkillsManager } from '../../modules/skills';

const MAX_RESOURCE_TEXT_CHARS = 300_000;

export function generateReadSkillResourceDeclaration(): ToolDeclaration {
    return {
        name: 'read_skill_resource',
        description: `Read one text resource bundled with an activated Skill by skill name and manifest relativePath.

Use this only after read_skill returns a resources manifest. The path must exactly match a manifest entry with textReadable=true. This tool does not accept absolute paths or ../ traversal and does not expose Skill filesystem roots. Binary assets are not read into context.`,
        category: 'skills',
        parameters: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Skill name from read_skill.'
                },
                relativePath: {
                    type: 'string',
                    description: 'Manifest relativePath to read, e.g. references/guide.md.'
                }
            },
            required: ['name', 'relativePath']
        }
    };
}

async function handleReadSkillResource(args: { name: string; relativePath: string }): Promise<ToolResult> {
    const skillsManager = getSkillsManager();
    if (!skillsManager) {
        return { success: false, error: 'Skills manager not initialized' };
    }

    const resolved = await skillsManager.resolveManifestResource(args.name, args.relativePath, { requireTextReadable: true });
    if (resolved.ok === false) {
        return { success: false, error: resolved.error };
    }

    const buffer = await fs.promises.readFile(resolved.realPath);
    const contentSha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (contentSha256 !== resolved.item.sha256) {
        return { success: false, error: 'Skill resource changed before read. Refresh skills and ask for confirmation again.' };
    }
    const content = buffer.toString('utf-8');
    const truncated = content.length > MAX_RESOURCE_TEXT_CHARS;
    return {
        success: true,
        data: {
            schemaVersion: 1,
            skillName: resolved.skill.name,
            skillUri: resolved.item.skillUri,
            relativePath: resolved.item.relativePath,
            sha256: contentSha256,
            content: truncated ? content.slice(0, MAX_RESOURCE_TEXT_CHARS) : content,
            truncated
        }
    };
}

export function getReadSkillResourceTool(): Tool {
    return {
        declaration: generateReadSkillResourceDeclaration(),
        handler: handleReadSkillResource
    };
}

export function getReadSkillResourceToolRegistration(): ToolRegistration {
    return () => getReadSkillResourceTool();
}
