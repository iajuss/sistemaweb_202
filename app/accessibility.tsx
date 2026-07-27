"use client";

import { KeyboardEvent, ReactNode, useEffect, useRef } from "react";

const seletorFocavel = [
  "a[href]", "button:not([disabled])", "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])", "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

function focaveis(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(seletorFocavel))
    .filter((elemento) => !elemento.hasAttribute("hidden"));
}

/** Modal compartilhado: fecha por Escape/overlay, prende o foco e bloqueia a rolagem do documento. */
export function AccessibleModal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    const elementoAnterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frame = requestAnimationFrame(() => {
      const content = contentRef.current;
      if (!content) return;
      const primeiroCampo = content.querySelector<HTMLElement>("[data-autofocus]")
        ?? focaveis(content).find((elemento) => !elemento.classList.contains("close"))
        ?? focaveis(content)[0];
      primeiroCampo?.focus();
    });

    const aoTeclar = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const content = contentRef.current;
      if (!content) return;
      const itens = focaveis(content);
      if (itens.length === 0) return;
      const primeiro = itens[0];
      const ultimo = itens.at(-1)!;
      if (event.shiftKey && document.activeElement === primeiro) {
        event.preventDefault();
        ultimo.focus();
      } else if (!event.shiftKey && document.activeElement === ultimo) {
        event.preventDefault();
        primeiro.focus();
      }
    };
    document.addEventListener("keydown", aoTeclar);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = overflowAnterior;
      elementoAnterior?.focus();
    };
  }, []);

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => {
    if (event.target === event.currentTarget) closeRef.current();
  }}><div className="modal-focus-scope" ref={contentRef}>{children}</div></div>;
}

/** Fecha controles ancorados quando seu ponto de origem deixa de ser confiável. */
export function useDismissOnViewportChange(active: boolean, onDismiss: () => void) {
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    if (!active) return;
    const dismiss = () => dismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [active]);
}

/** Contrato básico de teclado para menus: foco inicial, setas e Escape. */
export function useAccessibleMenu(active: boolean, onDismiss: () => void) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dismissRef = useRef(onDismiss);

  const fechar = () => {
    dismissRef.current();
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => focaveis(menuRef.current ?? document.body)[0]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [active]);

  const aoTeclar = (event: KeyboardEvent<HTMLDivElement>) => {
    const itens = focaveis(menuRef.current ?? event.currentTarget);
    const indice = itens.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      fechar();
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const passo = event.key === "ArrowDown" ? 1 : -1;
      itens[(indice + passo + itens.length) % itens.length]?.focus();
    }
  };

  return { menuRef, rememberOpener: (element: HTMLElement) => { openerRef.current = element; }, fechar, aoTeclar };
}
