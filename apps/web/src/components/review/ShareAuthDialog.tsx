import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ShareAuthDialogProps {
    open: boolean;
    onIdentify: (identity: { type: "guest"; name: string; email: string }) => void;
}

export function ShareAuthDialog({ open, onIdentify }: ShareAuthDialogProps) {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [email, setEmail] = useState("");

    const handleGuestSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim() && email.trim()) {
            onIdentify({ type: "guest", name: name.trim(), email: email.trim() });
        }
    };

    const handleLogin = () => {
        // Navigate to the app's local auth page, passing the current URL
        // so the user is redirected back after signing in.
        const returnUrl = encodeURIComponent(window.location.href);
        navigate(`/auth?redirectTo=${returnUrl}`);
    };

    return (
        <Dialog open={open} onOpenChange={() => { }}>
            <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
                <DialogHeader>
                    <DialogTitle>View Shared Asset</DialogTitle>
                    <DialogDescription>
                        Please identify yourself to view and comment on this asset.
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="guest" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="guest">Guest</TabsTrigger>
                        <TabsTrigger value="login">Member</TabsTrigger>
                    </TabsList>
                    <TabsContent value="guest">
                        <form onSubmit={handleGuestSubmit} className="space-y-4 pt-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Your Name</Label>
                                <Input
                                    id="name"
                                    placeholder="Jane Doe"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="jane@example.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    required
                                />
                            </div>
                            <Button type="submit" className="w-full">
                                Continue as Guest
                            </Button>
                        </form>
                    </TabsContent>
                    <TabsContent value="login">
                        <div className="flex flex-col items-center justify-center space-y-4 pt-4 py-6">
                            <p className="text-center text-muted-foreground text-sm">
                                Already have an account? Log in to access your workspace and history.
                            </p>
                            <Button onClick={handleLogin} variant="outline" className="w-full">
                                Log In / Sign Up
                            </Button>
                        </div>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
