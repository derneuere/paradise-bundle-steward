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
import VehiclesPage from "./pages/VehiclesPage";
import ColorsPage from "./pages/ColorsPage";
import IcePage from "./pages/IcePage";
import VehicleEditorPage from "./pages/VehicleEditorPage";
import ResourceInspectorPage from "./pages/ResourceInspectorPage";
import TriggerDataPage from "./pages/TriggerDataPage";
import ChallengeListPage from "./pages/ChallengeListPage";

const queryClient = new QueryClient();

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
              <Route path="/vehicles" element={<VehiclesPage />} />
              <Route path="/vehicles/:id" element={<VehicleEditorPage />} />
              <Route path="/colors" element={<ColorsPage />} />
              <Route path="/ice" element={<IcePage />} />
              <Route path="/inspect" element={<ResourceInspectorPage />} />
              <Route path="/triggers" element={<TriggerDataPage />} />
              <Route path="/challenges" element={<ChallengeListPage />} />
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
