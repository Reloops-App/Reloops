import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Crown, Shield, User, Eye, Pen } from "lucide-react";

export type UserRole = 
  | 'owner' | 'admin' | 'member' | 'billing' // org roles
  | 'manager' | 'collaborator' | 'viewer' | 'guest' | 'reviewer'; // project roles

type RoleBadgeProps = {
  role: UserRole;
  variant?: 'default' | 'compact';
  className?: string;
};

const roleConfig: Record<UserRole, { label: string; icon: any; color: string }> = {
  // Organization roles
  owner: { label: 'Owner', icon: Crown, color: 'text-yellow-600 bg-yellow-50 border-yellow-200 dark:text-yellow-400 dark:bg-yellow-950 dark:border-yellow-800' },
  admin: { label: 'Admin', icon: Shield, color: 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800' },
  member: { label: 'Member', icon: User, color: 'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-950 dark:border-blue-800' },
  billing: { label: 'Manager', icon: Shield, color: 'text-green-600 bg-green-50 border-green-200 dark:text-green-400 dark:bg-green-950 dark:border-green-800' },
  
  // Project roles
  manager: { label: 'Manager', icon: Crown, color: 'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-950 dark:border-purple-800' },
  collaborator: { label: 'Collaborator', icon: Pen, color: 'text-orange-600 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-950 dark:border-orange-800' },
  reviewer: { label: 'Reviewer', icon: Eye, color: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-950 dark:border-indigo-800' },
  viewer: { label: 'Viewer', icon: Eye, color: 'text-gray-600 bg-gray-50 border-gray-200 dark:text-gray-400 dark:bg-gray-950 dark:border-gray-800' },
  guest: { label: 'Guest', icon: User, color: 'text-slate-600 bg-slate-50 border-slate-200 dark:text-slate-400 dark:bg-slate-950 dark:border-slate-800' },
};

export function RoleBadge({ role, variant = 'default', className }: RoleBadgeProps) {
  const config = roleConfig[role];
  if (!config) return null;

  const Icon = config.icon;

  if (variant === 'compact') {
    return (
      <div 
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-medium border",
          config.color,
          className
        )}
        title={config.label}
      >
        <Icon className="w-3 h-3" />
      </div>
    );
  }

  return (
    <Badge 
      variant="outline" 
      className={cn(
        "text-xs font-medium border gap-1",
        config.color,
        className
      )}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}
