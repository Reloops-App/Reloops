import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AlertTriangle, ArrowLeft, FileX, Home, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface AssetNotFoundProps {
  workspaceId?: string;
  projectId?: string;
  assetId?: string;
  error?: "not_found" | "access_denied" | "unknown";
  onRetry?: () => void;
}

export default function AssetNotFound({ 
  workspaceId, 
  projectId, 
  assetId, 
  error = "not_found",
  onRetry 
}: AssetNotFoundProps) {
  const navigate = useNavigate();

  const handleGoBackToProject = () => {
    if (workspaceId && projectId) {
      navigate(`/workspace/${workspaceId}/projects/${projectId}`);
    } else if (workspaceId) {
      navigate(`/workspace/${workspaceId}/projects`);
    } else {
      navigate('/workspaces');
    }
  };

  const getErrorContent = () => {
    switch (error) {
      case "access_denied":
        return {
          icon: <AlertTriangle className="h-12 w-12 text-amber-500" />,
          title: "Access Denied",
          description: "You don't have permission to view this asset. Contact your workspace administrator if you believe this is an error.",
        };
      case "not_found":
        return {
          icon: <FileX className="h-12 w-12 text-slate-400" />,
          title: "Asset Not Found", 
          description: "This asset doesn't exist or has been deleted. It may have been removed by a workspace administrator.",
        };
      default:
        return {
          icon: <AlertTriangle className="h-12 w-12 text-red-500" />,
          title: "Something went wrong",
          description: "We encountered an error while loading this asset. Please try again or contact support if the problem persists.",
        };
    }
  };

  const { icon, title, description } = getErrorContent();

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-md w-full">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {icon}
            </EmptyMedia>
            <EmptyTitle className="text-xl font-semibold">
              {title}
            </EmptyTitle>
            <EmptyDescription className="text-center">
              {description}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        
        <div className="flex flex-col gap-2 mt-6">
          {onRetry && error === "unknown" && (
            <Button onClick={onRetry} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
          
          <Button 
            onClick={handleGoBackToProject}
            variant={onRetry && error === "unknown" ? "outline" : "default"}
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Button>
          
          <Button 
            variant="outline" 
            onClick={() => navigate('/workspaces')}
            className="w-full"
          >
            <Home className="mr-2 h-4 w-4" />
            Go to Workspaces
          </Button>
        </div>

        {assetId && (
          <div className="mt-4 p-3 bg-slate-50 rounded-lg">
            <p className="text-xs text-slate-500">
              Asset ID: <code className="font-mono">{assetId}</code>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}