export interface ProjectMeta {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
}

export const PROJECTS_ROOT = '/projects';
const PROJECTS_KEY = 'nanobuild-projects';
const CURRENT_PROJECT_KEY = 'nanobuild-current-project';
const PROJECTS_CHANGED_EVENT = 'projects:changed';
const DEFAULT_PROJECT_ID = 'default';

function nowIso() {
    return new Date().toISOString();
}

function slugify(input: string): string {
    const slug = input
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
    return slug || 'project';
}

function defaultProject(): ProjectMeta {
    const timestamp = nowIso();
    return {
        id: DEFAULT_PROJECT_ID,
        name: 'Default',
        createdAt: timestamp,
        updatedAt: timestamp
    };
}

function readProjectsUnsafe(): ProjectMeta[] {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [defaultProject()];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.filter((p): p is ProjectMeta => !!p && typeof p.id === 'string');
        }
    } catch {
        // fall through
    }
    return [defaultProject()];
}

function writeProjectsUnsafe(projects: ProjectMeta[]) {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
}

export function getProjects(): ProjectMeta[] {
    const projects = readProjectsUnsafe();
    if (!projects.some(p => p.id === DEFAULT_PROJECT_ID)) {
        projects.unshift(defaultProject());
        writeProjectsUnsafe(projects);
    }
    return projects;
}

export function getCurrentProjectId(): string {
    const projects = getProjects();
    const saved = localStorage.getItem(CURRENT_PROJECT_KEY);
    if (saved && projects.some(p => p.id === saved)) return saved;
    localStorage.setItem(CURRENT_PROJECT_KEY, projects[0].id);
    return projects[0].id;
}

export function setCurrentProjectId(projectId: string) {
    localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
}

export function createProject(name: string): ProjectMeta {
    const projects = getProjects();
    const baseId = slugify(name);
    let id = baseId;
    let suffix = 2;
    while (projects.some(p => p.id === id)) {
        id = `${baseId}-${suffix++}`;
    }

    const project: ProjectMeta = {
        id,
        name: name.trim() || 'Untitled',
        createdAt: nowIso(),
        updatedAt: nowIso()
    };

    const next = [...projects, project];
    writeProjectsUnsafe(next);
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
    return project;
}

export function touchProject(projectId: string) {
    const projects = getProjects().map(project => (
        project.id === projectId
            ? { ...project, updatedAt: nowIso() }
            : project
    ));
    writeProjectsUnsafe(projects);
}

export function getProjectRoot(projectId: string = getCurrentProjectId()): string {
    return `${PROJECTS_ROOT}/${projectId}`;
}

export function ensureProjectRegistry() {
    getProjects();
    getCurrentProjectId();
}

export function getProjectsChangedEventName() {
    return PROJECTS_CHANGED_EVENT;
}

