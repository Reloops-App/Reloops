import { getSessionToken } from "@/lib/supabaseClient";

const safeAssetUpdateFields = [
    "status",
    "version_no",
    "updated_by",
    "updated_at",
    "id",
    "assigned_to",
    "assigned_to_api_key_id",
    "description",
    "tags",
    "smart_tags",
    "smart_description",
];

export const updateAsset = async (body: { id: string } & Partial<Record<typeof safeAssetUpdateFields[number], any>>): Promise<Response> => {
    // confirm that asset_id is present
    if (!body.id) {
        throw new Error("id is required");
    }
    const safeBody = Object.fromEntries(
        Object.entries(body).filter(([key]) => safeAssetUpdateFields.includes(key))
    );


    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asset`, {
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

export const requestAssetRevision = async (body: { id: string }): Promise<Response> => {
    if (!body.id) {
        throw new Error("id is required");
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/asset`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${await getSessionToken()}`,
        },
        body: JSON.stringify({
            action: "request_revision",
            id: body.id,
        }),
    });

    return response;
};
