import { useEditor, type LeftTab } from '../../core/store';
import { Icon, type IconName } from '../icons';
import { LayersPanel } from './LayersPanel';
import { LibraryPanel } from './LibraryPanel';
import { AudioPanel } from './AudioPanel';
import { ProjectPanel } from './ProjectPanel';

const TABS: { id: LeftTab; label: string; icon: IconName }[] = [
  { id: 'layers', label: 'Layers', icon: 'layers' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'audio', label: 'Audio', icon: 'speaker' },
  { id: 'project', label: 'Project', icon: 'gear' },
];

export function LeftPanel() {
  const tab = useEditor((s) => s.ui.leftTab);
  const setUI = useEditor((s) => s.setUI);
  return (
    <>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setUI({ leftTab: t.id })}>
            <Icon name={t.icon} size={13} /><span>{t.label}</span>
          </button>
        ))}
      </div>
      {tab === 'layers' && <LayersPanel />}
      {tab === 'library' && <LibraryPanel />}
      {tab === 'audio' && <AudioPanel />}
      {tab === 'project' && <ProjectPanel />}
    </>
  );
}
