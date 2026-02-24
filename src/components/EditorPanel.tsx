import { useEffect, useMemo, useState } from 'preact/hooks';
import { initProjectWorkspace, listProjectFilesDeep, readProjectFile, writeProjectFile } from '../core/fs';
import { getProjectsChangedEventName } from '../core/projects';
import { triggerPreviewReload } from '../loop';

interface FileNode {
    name: string;
    path: string;
    type: 'file' | 'folder';
    children: FileNode[];
}

function buildFileTree(paths: string[]): FileNode[] {
    const root: FileNode = { name: '', path: '', type: 'folder', children: [] };

    for (const path of paths) {
        const segments = path.split('/').filter(Boolean);
        let current = root;
        segments.forEach((segment, index) => {
            const isLeaf = index === segments.length - 1;
            const nextPath = current.path ? `${current.path}/${segment}` : segment;
            let child = current.children.find(item => item.name === segment);
            if (!child) {
                child = {
                    name: segment,
                    path: nextPath,
                    type: isLeaf ? 'file' : 'folder',
                    children: []
                };
                current.children.push(child);
            }
            if (!isLeaf && child.type !== 'folder') {
                child.type = 'folder';
            }
            current = child;
        });
    }

    const sortTree = (nodes: FileNode[]) => {
        nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
        nodes.forEach(node => sortTree(node.children));
    };
    sortTree(root.children);

    return root.children;
}

function expandFoldersForFile(filePath: string): string[] {
    const trimmed = filePath.replace(/^\//, '');
    const segments = trimmed.split('/').filter(Boolean);
    if (segments.length <= 1) return [];
    const folders: string[] = [];
    for (let i = 0; i < segments.length - 1; i++) {
        const folderPath = segments.slice(0, i + 1).join('/');
        folders.push(folderPath);
    }
    return folders;
}

export function EditorPanel() {
    const [files, setFiles] = useState<string[]>([]);
    const [activeFile, setActiveFile] = useState<string>('/index.html');
    const [content, setContent] = useState<string>('');
    const [isSaving, setIsSaving] = useState(false);
    const [isDirty, setIsDirty] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<string[]>([]);

    const tree = useMemo(() => buildFileTree(files), [files]);

    useEffect(() => {
        loadFiles();
    }, []);

    useEffect(() => {
        if (activeFile) {
            loadFileContent(activeFile);
        }
    }, [activeFile]);

    useEffect(() => {
        if (!activeFile) return;
        setExpandedFolders(prev => Array.from(new Set([...prev, ...expandFoldersForFile(activeFile)])));
    }, [activeFile]);

    useEffect(() => {
        const handleWorkspaceChanged = async () => {
            await loadFiles();
            if (!isDirty && activeFile) {
                await loadFileContent(activeFile);
            }
        };

        const handleProjectChanged = async () => {
            await loadFiles();
            setActiveFile('/index.html');
            setExpandedFolders([]);
            setIsDirty(false);
        };

        window.addEventListener('workspace:changed', handleWorkspaceChanged);
        window.addEventListener(getProjectsChangedEventName(), handleProjectChanged);
        return () => {
            window.removeEventListener('workspace:changed', handleWorkspaceChanged);
            window.removeEventListener(getProjectsChangedEventName(), handleProjectChanged);
        };
    }, [activeFile, isDirty]);

    const loadFiles = async () => {
        await initProjectWorkspace();
        const projectFiles = await listProjectFilesDeep();
        const filtered = projectFiles.filter(f => !f.startsWith('.'));
        setFiles(filtered);
        if (filtered.length > 0 && !filtered.includes(activeFile.replace(/^\//, ''))) {
            const nextFile = `/${filtered[0]}`;
            setActiveFile(nextFile);
            setExpandedFolders(prev => Array.from(new Set([...prev, ...expandFoldersForFile(nextFile)])));
        }
    };

    const selectFile = (path: string) => {
        setActiveFile(path);
        setExpandedFolders(prev => Array.from(new Set([...prev, ...expandFoldersForFile(path)])));
    };

    const toggleFolder = (path: string) => {
        setExpandedFolders(prev => (
            prev.includes(path)
                ? prev.filter(item => item !== path)
                : [...prev, path]
        ));
    };

    const loadFileContent = async (path: string) => {
        try {
            const text = await readProjectFile(path);
            setContent(text);
            setIsDirty(false);
        } catch {
            setContent('');
            setIsDirty(false);
        }
    };

    const handleSave = async () => {
        if (!activeFile) return;
        setIsSaving(true);
        await writeProjectFile(activeFile, content);
        setIsDirty(false);
        window.dispatchEvent(new Event('workspace:changed'));
        triggerPreviewReload();
        setIsSaving(false);
    };

    const renderTreeNode = (node: FileNode, depth = 0) => {
        if (node.type === 'folder') {
            const expanded = expandedFolders.includes(node.path);
            return (
                <li key={node.path}>
                    <button
                        type="button"
                        className="flex items-center gap-1.5 w-full text-left"
                        style={{ paddingLeft: `${6 + depth * 10}px` }}
                        onClick={() => toggleFolder(node.path)}
                    >
                        <span className="opacity-70 text-[10px]">{expanded ? '▾' : '▸'}</span>
                        <span className="truncate">{node.name}</span>
                    </button>
                    {expanded && node.children.length > 0 && (
                        <ul className="menu menu-xs menu-compact bg-transparent p-0 m-0">
                            {node.children.map(child => renderTreeNode(child, depth + 1))}
                        </ul>
                    )}
                </li>
            );
        }

        const fullPath = `/${node.path}`;
        return (
            <li key={node.path}>
                <a
                    className={`flex gap-2 ${activeFile === fullPath ? 'active' : ''}`}
                    style={{ paddingLeft: `${16 + depth * 10}px` }}
                    onClick={() => selectFile(fullPath)}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-content opacity-70"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" /><polyline points="14 2 14 8 20 8" /></svg>
                    <span className="truncate">{node.name}</span>
                </a>
            </li>
        );
    };

    return (
        <div className="flex h-full bg-base-100">
            {/* File Explorer */}
            <div className="w-48 bg-base-200/50 border-r border-base-content/10 flex flex-col">
                <div className="p-3 text-xs font-bold uppercase tracking-wider text-base-content/50 border-b border-base-content/5">
                    Workspace Files
                </div>
                <ul className="menu menu-xs menu-compact flex-1 overflow-y-auto px-2 py-2 gap-1 bg-transparent">
                    {tree.map(node => renderTreeNode(node))}
                </ul>
            </div>

            {/* Code Editor Area */}
            <div className="flex-1 flex flex-col h-full bg-[#1e1e1e] text-[#d4d4d4]">
                {/* Editor Tab */}
                <div className="flex bg-[#252526] border-b border-[#333]">
                    <div className="px-4 py-2 bg-[#1e1e1e] border-t-2 border-primary text-sm flex items-center gap-2 text-[#e8e8e8]">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary opacity-70"><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>
                        {activeFile.replace('/', '')}
                        {isSaving && <span className="w-1.5 h-1.5 ml-2 rounded-full bg-warning animate-ping"></span>}
                    </div>
                    <div className="flex-1"></div>
                    <div className="flex items-center px-4">
                        <button title="Save (Cmd/Ctrl+S)" onClick={handleSave} className="hover:bg-white/10 p-1.5 rounded transition">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                        </button>
                    </div>
                </div>
                <textarea
                    value={content}
                    onInput={(e) => {
                        setContent(e.currentTarget.value);
                        setIsDirty(true);
                    }}
                    onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                            e.preventDefault();
                            handleSave();
                        }
                    }}
                    className="flex-1 w-full bg-transparent resize-none outline-none p-4 font-mono text-sm leading-relaxed"
                    spellcheck={false}
                />
            </div>
        </div>
    );
}
