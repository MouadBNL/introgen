import { useEditor } from '../../core/store';
import { LogoMark, LogoWordmark } from '../Logo';
import { Btn } from '../controls';
import { MenuList, Popover } from '../popover';
import { SHORTCUTS } from '../shortcuts';
import { useShell } from '../shell';
import { ExportDialog } from './ExportDialog';
import { Modal } from './Modal';

function ShortcutsDialog() {
  const setUI = useEditor((s) => s.setUI);
  return (
    <Modal title="Keyboard shortcuts" width={640} onClose={() => setUI({ shortcutsOpen: false })}>
      <div className="keys-grid">
        {SHORTCUTS.map((g) => (
          <div key={g.group}>
            <h4>{g.group}</h4>
            {g.items.map(([k, label]) => <div key={k} className="keys-row"><span>{label}</span><kbd>{k}</kbd></div>)}
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="About" width={360} onClose={() => useShell.setState({ aboutOpen: false })}>
      <div className="about">
        <LogoMark size={84} animated />
        <LogoWordmark size={22} />
        <p>A small studio for 2010s-style 3D sync intros, right in your browser.</p>
      </div>
    </Modal>
  );
}

function ConfirmDialog() {
  const c = useShell((s) => s.confirm)!;
  const answer = (v: boolean) => { useShell.setState({ confirm: null }); c.resolve(v); };
  return (
    <Modal title={c.title} width={380} onClose={() => answer(false)} footer={<>
      <span className="grow" />
      <Btn onClick={() => answer(false)}>Cancel</Btn>
      <Btn primary onClick={() => answer(true)}>{c.ok}</Btn>
    </>}>
      <p className="confirm-text">{c.body}</p>
    </Modal>
  );
}

function ContextMenu() {
  const menu = useShell((s) => s.menu)!;
  const close = () => useShell.setState({ menu: null });
  return (
    <Popover key={`${menu.x},${menu.y}`} anchor={{ x: menu.x, y: menu.y }} onClose={close} className="pop-menu">
      <MenuList items={menu.items} onDone={close} />
    </Popover>
  );
}

function Toast() {
  const toast = useEditor((s) => s.ui.toast);
  return toast ? <div key={toast.id} className="toast" role="status">{toast.text}</div> : null;
}

export function Overlays() {
  const exportOpen = useEditor((s) => s.ui.exportOpen);
  const shortcutsOpen = useEditor((s) => s.ui.shortcutsOpen);
  const aboutOpen = useShell((s) => s.aboutOpen);
  const confirm = useShell((s) => s.confirm);
  const menu = useShell((s) => s.menu);
  return (
    <>
      {exportOpen && <ExportDialog />}
      {shortcutsOpen && <ShortcutsDialog />}
      {aboutOpen && <AboutDialog />}
      {confirm && <ConfirmDialog />}
      {menu && <ContextMenu />}
      <Toast />
    </>
  );
}
