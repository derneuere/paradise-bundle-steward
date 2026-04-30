import { Suspense, createElement } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import BundleLayout from "./layouts/BundleLayout";
import ResourcesPage from "./pages/ResourcesPage";
import HexViewPage from "./pages/HexViewPage";
import ResourceInspectorPage from "./pages/ResourceInspectorPage";
import WorkspacePage from "./pages/WorkspacePage";
import { registry } from "@/lib/core/registry";
import { EDITOR_PAGES } from "@/lib/core/registry/editors";

const queryClient = new QueryClient();

// Generate one <Route path="/{key}" /> per registered handler that has an
// editor page mapped. Adding a new editable resource = one new entry in
// EDITOR_PAGES plus one registry/index.ts line. App.tsx stays untouched.
const handlerRoutes = registry
  .filter((h) => EDITOR_PAGES[h.key])
  .map((h) => (
    <Route
      key={h.key}
      path={`/${h.key}`}
      element={
        <Suspense fallback={<div className="p-6 text-muted-foreground">Loading {h.name}…</div>}>
          {createElement(EDITOR_PAGES[h.key])}
        </Suspense>
      }
    />
  ));

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <WorkspaceProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/resources" replace />} />
            <Route element={<BundleLayout />}>
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/hexview" element={<HexViewPage />} />
              <Route path="/inspect" element={<ResourceInspectorPage />} />
              {/* Multi-Bundle Workspace editor (issue #16). Coexists with the
                  per-resource pages above; #2 brings the additive load and
                  same-name prompt, #3 the multi-overlay scene composition. */}
              <Route path="/workspace" element={<WorkspacePage />} />
              {handlerRoutes}
            </Route>
            {/* Legacy index route kept if needed */}
            <Route path="/legacy" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </WorkspaceProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
