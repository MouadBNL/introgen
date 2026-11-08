import { useEffect } from 'react';
import { Viewport } from './render/Viewport';
import { Timeline } from './ui/timeline/Timeline';
import { TopBar } from './ui/TopBar';
import { TransportBar } from './ui/Transport';
import { LeftPanel } from './ui/panels/LeftPanel';
import { Inspector } from './ui/inspector/Inspector';
import { Overlays } from './ui/dialogs/Dialogs';
import { Splitter } from './ui/Splitter';
import { installShortcuts } from './ui/shortcuts';

export function App() {
  useEffect(() => installShortcuts(), []);
  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <aside className="panel panel-left"><LeftPanel /></aside>
        <Splitter panel="left" axis="x" dir={1} />
        <main className="center">
          <div className="viewport-wrap"><Viewport /></div>
          <TransportBar />
        </main>
        <Splitter panel="right" axis="x" dir={-1} />
        <aside className="panel panel-right"><Inspector /></aside>
      </div>
      <Splitter panel="timeline" axis="y" dir={-1} />
      <section className="timeline-wrap"><Timeline /></section>
      <Overlays />
    </div>
  );
}
