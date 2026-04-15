import { Suspense, createElement, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { BundleProvider } from "./context/BundleContext";
import BundleLayout from "./layouts/BundleLayout";
import ResourcesPage from "./pages/ResourcesPage";
import HexViewPage from "./pages/HexViewPage";
import VehicleEditorPage from "./pages/VehicleEditorPage";
import ResourceInspectorPage from "./pages/ResourceInspectorPage";
import { registry } from "@/lib/core/registry";
import { EDITOR_PAGES } from "@/lib/core/registry/editors";

// Schema-driven editor (Phase B preview). Side-by-side with the classic
// TrafficDataPage until parity is reached.
const TrafficDataEditorV2Page = lazy(() => import('./pages/TrafficDataEditorV2Page'));

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
        <BundleProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/resources" replace />} />
            <Route element={<BundleLayout />}>
              <Route path="/resources" element={<ResourcesPage />} />
              <Route path="/hexview" element={<HexViewPage />} />
              <Route path="/inspect" element={<ResourceInspectorPage />} />
              {/* Vehicle editor keeps its nested :id route; the list page is
                  generated from the registry like the other editors. */}
              <Route path="/vehicleList/:id" element={<VehicleEditorPage />} />
              {/* Schema editor preview — must come BEFORE handlerRoutes
                  so it isn't shadowed by a generic /trafficdata-v2 handler. */}
              <Route
                path="/trafficData-v2"
                element={
                  <Suspense fallback={<div className="p-6 text-muted-foreground">Loading schema editor…</div>}>
                    <TrafficDataEditorV2Page />
                  </Suspense>
                }
              />
              {handlerRoutes}
            </Route>
            {/* Legacy index route kept if needed */}
            <Route path="/legacy" element={<Index />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BundleProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
