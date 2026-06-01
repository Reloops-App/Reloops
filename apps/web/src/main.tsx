import "./instrument";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";
import { BrowserRouter as Router, Route, Routes } from "react-router-dom";

import App from "./App";
import Auth from "./pages/Auth/Auth";
import Workspaces from "./pages/Workspaces/Workspaces";
import SidebarLayout from "./components/layout/SidebarLayout";
import RequireAuth from "@/components/auth/RequireAuth";
import Projects from "./pages/Home/Projects";
import AppSidebar from "./components/sidebar/Appsidebar";
import CompareVersionsPage from "./pages/Review/CompareVersionsPage";
import ReviewAsset from "./pages/Review/ReviewAsset";
import ShareAsset from "./pages/Review/ShareAsset";
import ShareCollection from "./pages/Review/ShareCollection";
import ShareCollectionAsset from "./pages/Review/ShareCollectionAsset";
import { Toaster } from "./components/ui/sonner";
import Teams from "./pages/OrgTeams/Teams";
import AcceptInvitation from "./pages/Invitation/AcceptInvitation";
import WorkspaceSettings from "./pages/Settings/WorkspaceSettings";
import AccountSettings from "./pages/Settings/AccountSettings";
import WorkspaceViewPage from "./pages/Collections/CollectionsPage";
import CollectionsIndexPage from "./pages/Collections/CollectionsIndexPage";
import CollectionDetailPage from "./pages/Collections/CollectionDetailPage";
import { CampaignPage } from "./pages/Campaign/Campaign";
import WorkspaceAssetSearchPage from "./pages/Search/WorkspaceAssetSearchPage";
import ForgotPassword from "./pages/Auth/ForgotPassword";
import ResetPassword from "./pages/Auth/ResetPassword";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/workspaces" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><Workspaces /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/teams" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><Teams /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><Projects /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/projects" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><Projects /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/assets" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><WorkspaceAssetSearchPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/projects/:projectId" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><CampaignPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/projects/:projectId/assets/:assetId" element={<RequireAuth><SidebarLayout defaultOpen={false} sidebar={<AppSidebar />}><ReviewAsset /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/assets/:assetId" element={<RequireAuth><SidebarLayout defaultOpen={false} sidebar={<AppSidebar />}><ReviewAsset /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/assets/:parentAssetId/compare" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><CompareVersionsPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/projects/:projectId/assets/:parentAssetId/compare" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><CompareVersionsPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/settings" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><WorkspaceSettings /></SidebarLayout></RequireAuth>} />
        <Route path="/account" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><AccountSettings /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/collections" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><CollectionsIndexPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/collections/:collectionId" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><CollectionDetailPage /></SidebarLayout></RequireAuth>} />
        <Route path="/workspace/:workspaceId/views/:collectionName" element={<RequireAuth><SidebarLayout sidebar={<AppSidebar />}><WorkspaceViewPage /></SidebarLayout></RequireAuth>} />

        <Route path="/share/:token" element={<ShareAsset />} />
        <Route path="/share/collection/:token" element={<ShareCollection />} />
        <Route path="/share/collection/:token/asset/:assetId" element={<ShareCollectionAsset />} />
        <Route path="/accept-invitation" element={<AcceptInvitation />} />
        <Route path="*" element={<div>404 Not Found</div>} />
      </Routes>
    </Router>
    <Toaster />
  </StrictMode>,
);
