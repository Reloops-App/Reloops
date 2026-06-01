import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { AlertTriangle, ArrowLeft, FolderX, Home } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface ProjectNotFoundProps {
  workspaceId?: string;
  projectId?: string;
  error?: "not_found" | "access_denied" | "unknown";
}

export default function ProjectNotFound({ workspaceId, projectId, error = "not_found" }: ProjectNotFoundProps) {
  const navigate = useNavigate();

  const handleGoBackToProjects = () => {
    if (workspaceId) {
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
          description: "You don't have permission to view this project. Contact your workspace administrator if you believe this is an error.",
        };
      case "not_found":
        return {
          icon: <FolderX className="h-100 w-100 text-slate-400" />,
          title: "Project Not Found", 
          description: "This project doesn't exist or has been deleted. It may have been removed by a workspace administrator.",
        };
      default:
        return {
          icon: <AlertTriangle className="h-12 w-12 text-red-500" />,
          title: "Something went wrong",
          description: "We encountered an error while loading this project. Please try again or contact support if the problem persists.",
        };
    }
  };

  const { icon, title, description } = getErrorContent();

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="max-w-md w-full h-full">
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
          <Button 
            onClick={handleGoBackToProjects}
            className="w-full"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
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

       
      </div>
    </div>
  );
}