import { useEffect, useMemo, useState } from 'preact/hooks';
import { createProject, getCurrentProjectId, getProjects, getProjectsChangedEventName, setCurrentProjectId } from '../core/projects';
import { exportProjectAsZip, initProjectWorkspace } from '../core/fs';
import { triggerPreviewReload } from '../loop';

export function ProjectControls() {
    const [projects, setProjects] = useState(getProjects());
    const [currentProjectId, setCurrentProjectState] = useState(getCurrentProjectId());
    const [isExporting, setIsExporting] = useState(false);

    const projectOptions = useMemo(
        () => projects.map(project => ({ id: project.id, label: project.name || project.id })),
        [projects]
    );

    useEffect(() => {
        const refresh = () => {
            setProjects(getProjects());
            setCurrentProjectState(getCurrentProjectId());
        };

        window.addEventListener(getProjectsChangedEventName(), refresh);
        return () => window.removeEventListener(getProjectsChangedEventName(), refresh);
    }, []);

    const switchProject = async (projectId: string) => {
        setCurrentProjectId(projectId);
        await initProjectWorkspace(projectId);
        window.dispatchEvent(new Event('workspace:changed'));
        triggerPreviewReload();
    };

    const createNewProject = async () => {
        const name = window.prompt('Project name');
        if (!name || !name.trim()) return;
        const project = createProject(name.trim());
        await initProjectWorkspace(project.id);
        await switchProject(project.id);
    };

    const exportCurrentProject = async () => {
        setIsExporting(true);
        try {
            await exportProjectAsZip(currentProjectId);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div className="flex items-center gap-2 shrink-0">
            <select
                className="select select-sm select-bordered bg-base-100/80 border-base-content/15 min-w-40 max-w-56 h-8"
                value={currentProjectId}
                onChange={(e) => switchProject(e.currentTarget.value)}
                title="Switch project"
            >
                {projectOptions.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                ))}
            </select>

            <button className="btn btn-sm btn-ghost border border-base-content/15 h-8 min-h-8 px-3" onClick={createNewProject} title="Create project">
                New
            </button>

            <button
                className="btn btn-sm btn-ghost border border-base-content/15 h-8 min-h-8 px-3"
                onClick={exportCurrentProject}
                disabled={isExporting}
                title="Export current project"
            >
                {isExporting && <span className="loading loading-spinner loading-xs"></span>}
                {isExporting ? 'Exporting...' : 'Export'}
            </button>
        </div>
    );
}
