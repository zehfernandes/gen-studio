import { mountSelectControl } from 'dialkit/vanilla';
import type { VersionInfo } from './types';

export interface SidebarActions {
  onSelect: (name: string) => void;
  onLoadVersion: (id: string) => void;
  onDeleteVersion: (id: string) => void;
}

export class Sidebar {
  el: HTMLElement;
  versionsEl: HTMLElement;
  private actions: SidebarActions;
  private sketchSelect: { update(props: ReturnType<Sidebar['selectProps']>): void; destroy(): void };
  private names: string[] = [];
  private current = '';

  constructor(parent: HTMLElement, actions: SidebarActions) {
    this.actions = actions;
    this.el = document.createElement('aside');
    this.el.id = 'sidebar';
    parent.appendChild(this.el);

    // The picker is the panel's select, so the head is its `.dialkit-root`: that is where the
    // theme's custom properties are declared, and the control is unstyled without them.
    const head = document.createElement('div');
    head.id = 'sidebar-head';
    head.className = 'dialkit-root';
    head.dataset.theme = 'dark';
    this.el.appendChild(head);
    this.sketchSelect = mountSelectControl(head, this.selectProps());

    this.versionsEl = document.createElement('div');
    this.versionsEl.id = 'versions';
    this.el.appendChild(this.versionsEl);
  }

  private selectProps() {
    return {
      label: 'sketch',
      value: this.current,
      // `{ value, label }`, not bare strings: dialkit title-cases a string option, and a sketch
      // name is a folder name — `example-canvas2d` must not render as `Example-Canvas2d`.
      options: this.names.map((name) => ({ value: name, label: name })),
      onChange: (name: string) => {
        this.current = name;
        this.sketchSelect.update(this.selectProps()); // controlled widget
        this.actions.onSelect(name);
      },
    };
  }

  setSketches(sketches: { name: string; entry: string }[], current: string) {
    this.names = sketches.map((s) => s.name);
    this.current = current;
    this.sketchSelect.update(this.selectProps());
  }

  setVersions(versions: VersionInfo[], currentId: string | null, name: string) {
    const actions = this.actions;
    this.versionsEl.innerHTML = '';
    if (versions.length === 0) {
      this.versionsEl.innerHTML = '<div class="versions-empty">No saved versions</div>';
      return;
    }

    for (const v of versions) {
      const row = document.createElement('div');
      row.className = 'version';
      row.dataset.id = v.id;
      if (v.id === currentId) row.classList.add('active');

      const img = document.createElement('img');
      img.src = `/sketches/${encodeURIComponent(name)}/versions/${v.id}/thumb.png`;
      img.alt = `version ${v.id}`;
      img.loading = 'lazy';
      img.onerror = () => {
        img.style.display = 'none';
      };
      row.appendChild(img);

      const label = document.createElement('span');
      label.className = 'version-id';
      label.textContent = v.id;
      row.appendChild(label);

      const del = document.createElement('button');
      del.className = 'version-delete';
      del.textContent = '×';
      del.title = 'Delete';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        actions.onDeleteVersion(v.id);
      });
      row.appendChild(del);

      row.addEventListener('click', () => actions.onLoadVersion(v.id));
      this.versionsEl.appendChild(row);
    }
  }

  setActiveVersion(id: string | null) {
    for (const row of this.versionsEl.querySelectorAll<HTMLElement>('.version')) {
      row.classList.toggle('active', row.dataset.id === id);
    }
  }
}
