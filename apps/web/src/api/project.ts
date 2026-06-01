import { getSessionToken } from "@/lib/supabaseClient";



export const createProject = async (body: Partial<{ name: string, workspaceId: string }>): Promise<Response> => {
    const safeBody = Object.fromEntries(
        Object.entries(body).filter(([key]) => ["name", "workspaceId"].includes(key))
    );
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${await getSessionToken()}`,
        },
        body: JSON.stringify({
            ...safeBody,
        }),
    });
    return response;
}

export const updateProject = async (body: { id: string } & Partial<{ name: string; status: string }>): Promise<Response> => {
    const safeBody = Object.fromEntries(
        Object.entries(body).filter(([key]) => ["name", "status", "id"].includes(key))
    );
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${await getSessionToken()}`,
        },
        body: JSON.stringify({
            ...safeBody,
        }),
    });
    return response;
}

export const deleteProject = async (id: string): Promise<Response> => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/project?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
            "Authorization": `Bearer ${await getSessionToken()}`,
        },
    });
    return response;
}
