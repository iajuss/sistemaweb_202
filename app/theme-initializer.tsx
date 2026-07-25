"use client";

import { useEffect } from "react";

export function ThemeInitializer() {
  useEffect(() => {
    const theme = window.localStorage.getItem("controle-carteira-theme");
    const authPage = ["/login", "/signup"].includes(window.location.pathname);
    document.documentElement.dataset.theme = authPage ? "light" : theme === "dark" ? "dark" : "light";
  }, []);

  return null;
}
