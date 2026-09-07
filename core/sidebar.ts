import type { VersionInfo } from './types';

export interface SidebarActions {
  onSelect: (name: string) => void;
  onLoadVersion: (id: string) => void;
  onDeleteVersion: (id: string) => void;
}

export class Sidebar {
  el: HTMLElement;
  sketchSelect: HTMLSelectElement;
  versionsEl: HTMLElement;
  private actions: SidebarActions;

  constructor(parent: HTMLElement, actions: SidebarActions) {
    this.actions = actions;
    this.el = document.createElement('aside');
    this.el.id = 'sidebar';
    parent.appendChild(this.el);

    const head = document.createElement('div');
    head.id = 'sidebar-head';
    this.el.appendChild(head);

    this.sketchSelect = document.createElement('select');
    this.sketchSelect.id = 'sketch-select';
    this.sketchSelect.addEventListener('change', () => actions.onSelect(this.sketchSelect.value));
    head.appendChild(this.sketchSelect);

    this.versionsEl = document.createElement('div');
    this.versionsEl.id = 'versions';
    this.el.appendChild(this.versionsEl);
  }

  setSketches(sketches: { name: string; entry: string }[], current: string) {
    this.sketchSelect.innerHTML = '';
    for (const s of sketches) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      if (s.name === current) opt.selected = true;
      this.sketchSelect.appendChild(opt);
    }
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
