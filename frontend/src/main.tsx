import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import "./lib/i18n";
import App from "./app/App";
import "./index.css";

// In Electron Desktop, intercept window.open on blob: URLs to prevent blank frames
if (window.electronAPI?.isDesktop) {
  const originalOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string): Window | null {
    const urlStr = typeof url === "string" ? url : url?.toString() || "";
    if (urlStr.startsWith("blob:")) {
      fetch(urlStr)
        .then((res) => res.blob())
        .then(async (blob) => {
          if (blob.type === "application/pdf" || blob.size > 0) {
            const { viewPdfDocument } = await import("./lib/pdfViewer");
            viewPdfDocument(blob, { title: "Document PDF" });
          } else {
            originalOpen.call(window, url, target, features);
          }
        })
        .catch(() => {
          originalOpen.call(window, url, target, features);
        });
      return null;
    }
    return originalOpen.call(window, url, target, features);
  };
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </React.StrictMode>
);
