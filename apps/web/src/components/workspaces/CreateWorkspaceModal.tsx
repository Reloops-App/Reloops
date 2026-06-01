'use client'

import * as React from 'react'
import { z } from 'zod'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Plus } from 'lucide-react'

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
    Select,
    SelectTrigger,
    SelectContent,
    SelectItem,
    SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { invokeEdgeFunction } from '@/api/edge'
type OrgOption = { id: string; name: string }

const schema = z.object({
    name: z
        .string()
        .min(2, 'Name is too short')
        .max(80, 'Name is too long')
        .trim(),
    organization_id: z.string().uuid('Select an organization'),
})

type FormValues = z.infer<typeof schema>

export function CreateWorkspaceModal({
    open,
    onOpenChange,
    onCreated,
}: {
    open: boolean
    onOpenChange: (v: boolean) => void
    /** Called with the newly created workspace id */
    onCreated?: (workspaceId: string) => void
}) {

    const [orgs, setOrgs] = React.useState<OrgOption[]>([])
    const [loadingOrgs, setLoadingOrgs] = React.useState(true)
    const [creating, setCreating] = React.useState(false)

    const form = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: { name: '', organization_id: '' },
    })

    // Load organizations the current user belongs to
    React.useEffect(() => {
        if (!open) return
            ; (async () => {
                setLoadingOrgs(true)
                try {
                    const { data, error } = await invokeEdgeFunction<{ data: OrgOption[] }>("workspace", {
                        body: { action: "admin-orgs" },
                    })
                    if (error) throw error
                    const options = Array.isArray((data as any)?.data) ? ((data as any).data as OrgOption[]) : []
                    setOrgs(options)

                    // If exactly one org, preselect it
                    if (options.length === 1) {
                        form.setValue('organization_id', options[0].id, { shouldValidate: true })
                    }
                } catch (e: any) {
                    toast(
                        'Failed to load organizations'
                    )
                } finally {
                    setLoadingOrgs(false)
                }
            })()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const onSubmit = form.handleSubmit(async (values) => {
        setCreating(true);
        try {
            const { data, error } = await invokeEdgeFunction("create-workspace", {
                body: {
                    name: values.name,
                    organization_id: values.organization_id,
                },
            });

            if (error) {
                toast("Could not create workspace: " + error.message);
                return;
            }

            toast("Workspace created");
            onOpenChange(false);
            onCreated?.(data.workspace_id);
            form.reset();
        } catch (e: any) {
            toast("Could not create workspace");
        } finally {
            setCreating(false);
        }
    });


    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Create workspace</DialogTitle>
                        <DialogDescription>
                            Choose an organization and a name for your new workspace.
                        </DialogDescription>
                    </DialogHeader>

                    <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="organization_id">Organization</Label>
                            <Select
                                value={form.watch('organization_id')}
                                onValueChange={(v) => form.setValue('organization_id', v, { shouldValidate: true })}
                                disabled={loadingOrgs}
                            >
                                <SelectTrigger id="organization_id">
                                    <SelectValue placeholder={loadingOrgs ? 'Loading...' : 'Select an organization'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {orgs.map((o) => (
                                        <SelectItem key={o.id} value={o.id}>
                                            {o.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {form.formState.errors.organization_id && (
                                <p className="text-xs text-destructive">
                                    {form.formState.errors.organization_id.message}
                                </p>
                            )}
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="name">Workspace name</Label>
                            <Input
                                id="name"
                                placeholder="e.g. Design System, Data Lab, Marketing"
                                {...form.register('name')}
                            />
                            {form.formState.errors.name && (
                                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                            )}
                        </div>

                        <DialogFooter className="gap-2">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                                Cancel
                            </Button>
                            <Button type="submit" disabled={creating}>
                                {creating ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Creating…
                                    </>
                                ) : (
                                    <>
                                        <Plus className="mr-2 h-4 w-4" />
                                        Create
                                    </>
                                )}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
        </Dialog>
    )
}
