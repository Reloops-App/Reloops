// SidebarLayout.tsx
'use client'
import { SidebarProvider } from '@/components/ui/sidebar'

export default function SidebarLayout({
  sidebar,
  header,
  children,
  defaultOpen,
}: {
  sidebar?: React.ReactNode
  header?: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {

  
  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <div className="flex min-h-dvh w-full">
        {sidebar} {/* Sidebar is a fixed-width flex item */}
        <div className="flex flex-col flex-1">
          {/* flex-1 ensures this grows to fill the remaining width */}
          {header} {/* put header at the top */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>

  )
}
