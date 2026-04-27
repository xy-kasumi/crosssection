// Right-column debug surface. Currently just the Primitives list — a flat
// readout of every primitive (disk / outers / holes) in the authoring
// shape, with click-to-select and ✕-to-delete. Explicitly debug, not
// product UI: don't pour design effort here.

import { rectOutline, type Selection } from "../authoring.ts";
import type { Editor } from "../editor.ts";

export class DebugPane {
  private readonly editor: Editor;
  private readonly list: HTMLUListElement;

  constructor(editor: Editor) {
    this.editor = editor;
    this.list = document.getElementById("prim-list") as HTMLUListElement;
  }

  refresh(): void {
    const s = this.editor.getShape();
    const sel = this.editor.getSelection();
    const items: { tag: string; desc: string; sel: Selection; key: string }[] = [];
    if (s.kind === "disk") {
      items.push({
        tag: "DISK",
        desc: `r=${s.r.toFixed(2)} @ (${s.cx.toFixed(1)}, ${s.cy.toFixed(1)})`,
        sel: { kind: "disk" },
        key: "disk",
      });
    } else {
      s.outers.forEach((o, i) => {
        items.push({
          tag: `OUT ${i + 1}`,
          desc: `${o.length}-vertex polygon`,
          sel: { kind: "outer", index: i },
          key: `outer-${i}`,
        });
      });
    }
    s.holes.forEach((h, i) => {
      if (h.kind === "circle") {
        items.push({
          tag: `HOLE ${i + 1}`,
          desc: `circle r=${h.r.toFixed(2)} @ (${h.cx.toFixed(1)}, ${h.cy.toFixed(1)})`,
          sel: { kind: "hole", index: i },
          key: `hole-${i}`,
        });
      } else {
        items.push({
          tag: `HOLE ${i + 1}`,
          desc: `${h.outline.length}-vertex polygon`,
          sel: { kind: "hole", index: i },
          key: `hole-${i}`,
        });
      }
    });

    this.list.innerHTML = "";
    for (const it of items) {
      const li = document.createElement("li");
      if (sel && selectionEq(sel, it.sel)) li.classList.add("selected");
      const tag = document.createElement("span");
      tag.className = "prim-tag";
      tag.textContent = it.tag;
      const desc = document.createElement("span");
      desc.className = "prim-desc";
      desc.textContent = it.desc;
      li.appendChild(tag);
      li.appendChild(desc);
      // Disk can't be deleted (it's the whole shape); outers and holes can.
      if (it.sel.kind !== "disk") {
        const del = document.createElement("button");
        del.className = "prim-del";
        del.textContent = "✕";
        del.title = "delete";
        del.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.deletePrim(it.sel);
        });
        li.appendChild(del);
      }
      li.addEventListener("click", () => this.editor.setSelection(it.sel));
      this.list.appendChild(li);
    }
  }

  private deletePrim(sel: Selection): void {
    this.editor.mutate((s) => {
      if (sel.kind === "outer" && s.kind === "polygon") {
        s.outers.splice(sel.index, 1);
        // If the user deleted the last outer, reset back to a default.
        if (s.outers.length === 0) s.outers.push(rectOutline(0, 0, 10, 10));
      } else if (sel.kind === "hole") {
        s.holes.splice(sel.index, 1);
      }
      this.editor.setSelection(null);
    });
  }
}

function selectionEq(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "disk") return b.kind === "disk";
  return (a as { index: number }).index === (b as { index: number }).index;
}
