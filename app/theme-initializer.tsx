"use client";

import { useEffect } from "react";

export function ThemeInitializer() {
  useEffect(() => {
    const theme = window.localStorage.getItem("controle-carteira-theme");
    const vision = window.localStorage.getItem("controle-carteira-vision");
    const fontSize = window.localStorage.getItem("controle-carteira-font-size");
    const authPage = ["/login", "/signup"].includes(window.location.pathname);
    document.documentElement.dataset.theme = authPage ? "light" : theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.vision = vision === "colorblind" ? "colorblind" : "default";
    document.documentElement.dataset.fontSize = ["small", "normal", "large"].includes(fontSize ?? "") ? fontSize! : "normal";
  }, []);

  return null;
}
