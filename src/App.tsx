import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import BundleLayout from "./layouts/BundleLayout";
import HexViewPage from "./pages/HexViewPage";
import ResourceInspectorPage from "./pages/ResourceInspectorPage";
import WorkspacePage from "./pages/WorkspacePage";

const queryClient = new QueryClient();

// The multi-Bundle Workspace (/workspace) is the sole resource editor — every
// resource type is viewed and edited there. The Hex View / Resource Inspector
// routes remain as byte-level debug tooling. The standalone per-resource pages
// and the resource browser were folded into the Workspace.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <WorkspaceProvider>
          <Routes>
            <Route path="/" element={<Navigate to="/workspace" replace />} />
            <Route element={<BundleLayout />}>
              <Route path="/workspace" element={<WorkspacePage />} />
              <Route path="/hexview" element={<HexViewPage />} />
              <Route path="/inspect" element={<ResourceInspectorPage />} />
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
