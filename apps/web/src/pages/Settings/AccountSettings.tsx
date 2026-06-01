import React from "react"
import { supabase } from "@/lib/supabaseClient"
import {
    Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils"

export default function AccountSettings() {
    const fileInputRef = React.useRef<HTMLInputElement | null>(null)

    const [loading, setLoading] = React.useState(true)
    const [saving, setSaving] = React.useState(false)
    const [uploading, setUploading] = React.useState(false)

    const [user, setUser] = React.useState<any>(null)

    // Fields
    const [name, setName] = React.useState("")
    const [email, setEmail] = React.useState("")
    const [avatarUrl, setAvatarUrl] = React.useState<string | null>(null)
    const [jobTitle, setJobTitle] = React.useState("")
    const [company, setCompany] = React.useState("")
    const [bio, setBio] = React.useState("")
    const [website, setWebsite] = React.useState("")

    // Initial state for dirty check
    const [initialState, setInitialState] = React.useState({
        name: "",
        avatarUrl: null as string | null,
        jobTitle: "",
        company: "",
        bio: "",
        website: "",
    })

    const isDirty =
        name !== initialState.name ||
        avatarUrl !== initialState.avatarUrl ||
        jobTitle !== initialState.jobTitle ||
        company !== initialState.company ||
        bio !== initialState.bio ||
        website !== initialState.website

    React.useEffect(() => {
        let mounted = true

        async function loadUser() {
            try {
                setLoading(true)
                const { data: { user } } = await supabase.auth.getUser()
                if (!mounted) return

                if (user) {
                    setUser(user)
                    const meta = user.user_metadata || {}

                    const data = {
                        name: (meta.full_name || meta.name || meta.display_name || "").trim(),
                        avatarUrl: meta.avatar_url || meta.picture || null,
                        jobTitle: meta.job_title || "",
                        company: meta.company || "",
                        bio: meta.bio || "",
                        website: meta.website || "",
                    }

                    setName(data.name)
                    setEmail(user.email || "")
                    setAvatarUrl(data.avatarUrl)
                    setJobTitle(data.jobTitle)
                    setCompany(data.company)
                    setBio(data.bio)
                    setWebsite(data.website)

                    setInitialState(data)
                }
            } catch (e) {
                console.error("Failed to load user", e)
                toast("Failed to load user profile")
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadUser()

        return () => { mounted = false }
    }, [])

    const handleSave = async () => {
        if (!user) return
        setSaving(true)
        try {
            const updates = {
                full_name: name,
                name: name,
                avatar_url: avatarUrl,
                job_title: jobTitle,
                company: company,
                bio: bio,
                website: website,
            }

            const { error } = await supabase.auth.updateUser({
                data: updates
            })
            if (error) throw error

            setInitialState({
                name,
                avatarUrl,
                jobTitle,
                company,
                bio,
                website,
            })
            toast("Profile updated")
        } catch (e) {
            console.error(e)
            toast("Could not update profile")
        } finally {
            setSaving(false)
        }
    }

    const handleUploadClick = () => fileInputRef.current?.click()

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !user) return
        setUploading(true)
        try {
            const fileExt = file.name.split('.').pop()
            const filePath = `avatars/${user.id}/${Date.now()}.${fileExt}`

            const { error: uploadErr } = await supabase.storage
                .from("avatars")
                .upload(filePath, file, { upsert: true })

            if (uploadErr) throw uploadErr

            const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath)
            const publicUrl = urlData?.publicUrl ?? null
            setAvatarUrl(publicUrl)
            toast("Image uploaded; press Save to apply")
        } catch (e) {
            console.error(e)
            toast("Image upload failed")
        } finally {
            setUploading(false)
            if (e.currentTarget) e.currentTarget.value = ""
        }
    }

    if (loading) {
        return (
            <div className="min-h-full w-full bg-background px-4 py-5 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-4xl space-y-6">
                    <div className="flex items-start gap-3">
                        <SidebarTrigger className="mt-1" />
                        <div className="space-y-3">
                            <Skeleton className="h-7 w-48" />
                            <Skeleton className="h-4 w-80" />
                        </div>
                    </div>
                    <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                        <Skeleton className="h-6 w-32 mb-2" />
                        <Skeleton className="h-4 w-64" />
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center gap-4">
                            <Skeleton className="size-20 rounded-full" />
                            <div className="space-y-2">
                                <Skeleton className="h-9 w-32" />
                            </div>
                        </div>
                        <div className="space-y-4">
                            <Skeleton className="h-10 w-full" />
                            <Skeleton className="h-10 w-full" />
                        </div>
                    </CardContent>
                    </Card>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-full w-full bg-background px-4 py-5 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex items-start gap-3">
                <SidebarTrigger className="mt-1" />
                <div className="space-y-1">
                    <h1 className="text-2xl font-semibold tracking-tight">Account Settings</h1>
                    <p className="text-sm text-muted-foreground">
                        Manage your personal information and public profile.
                    </p>
                </div>
            </div>

            <div className="grid gap-6">
                {/* Public Profile Section */}
                <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                        <CardTitle>Public Profile</CardTitle>
                        <CardDescription>This information will be displayed publicly.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        {/* Avatar */}
                        <div className="flex flex-col sm:flex-row items-start gap-6">
                            <div className="flex flex-col items-center gap-3">
                                <Avatar className="size-24 border-2 border-border">
                                    {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : (
                                        <AvatarFallback className={`${AVATAR_FALLBACK_CLASS} text-2xl`}>
                                            {getAvatarInitials(name)}
                                        </AvatarFallback>
                                    )}
                                </Avatar>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    onChange={handleFileChange}
                                    className="hidden"
                                    disabled={uploading}
                                />
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={handleUploadClick}
                                    disabled={uploading}
                                    className="w-full"
                                >
                                    {uploading ? "Uploading…" : "Change avatar"}
                                </Button>
                            </div>

                            <div className="flex-1 space-y-1">
                                <h3 className="font-medium">Profile Picture</h3>
                                <p className="text-sm text-muted-foreground">
                                    We support PNGs, JPGs, and GIFs under 10MB.
                                </p>
                            </div>
                        </div>

                        <Separator />

                        {/* Basic Info */}
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input
                                    id="name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder="e.g. Jane Doe"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="jobTitle">Job Title <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                                <Input
                                    id="jobTitle"
                                    value={jobTitle}
                                    onChange={(e) => setJobTitle(e.target.value)}
                                    placeholder="e.g. Senior Designer"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="company">Company <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                                <Input
                                    id="company"
                                    value={company}
                                    onChange={(e) => setCompany(e.target.value)}
                                    placeholder="e.g. Acme Inc."
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="website">Website <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                                <Input
                                    id="website"
                                    value={website}
                                    onChange={(e) => setWebsite(e.target.value)}
                                    placeholder="https://example.com"
                                />
                            </div>

                            <div className="space-y-2 sm:col-span-2">
                                <Label htmlFor="bio">Bio <span className="text-muted-foreground font-normal">(Optional)</span></Label>
                                <Textarea
                                    id="bio"
                                    value={bio}
                                    onChange={(e) => setBio(e.target.value)}
                                    placeholder="Tell us a little bit about yourself"
                                    className="min-h-[100px] resize-y"
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Brief description for your profile.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Personal Information Section */}
                <Card className="border-border/60 shadow-sm">
                    <CardHeader>
                        <CardTitle>Personal Information</CardTitle>
                        <CardDescription>Private details only visible to you.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input id="email" value={email} disabled className="bg-muted" />
                                <p className="text-[10px] text-muted-foreground">
                                    Your email address is managed through your login provider.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="justify-end border-t bg-muted/40 px-6 py-4">
                        <Button onClick={handleSave} disabled={saving || !isDirty}>
                            {saving ? "Saving…" : "Save changes"}
                        </Button>
                    </CardFooter>
                </Card>
            </div>
            </div>
        </div>
    )
}
