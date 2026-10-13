"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { setInstructorPhoto } from "./actions";

const MAX_BYTES = 5 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function PhotoUploader({ userId, currentUrl, firstName }: { userId: string; currentUrl: string | null; firstName: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(currentUrl);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    const ext = TYPES[file.type];
    if (!ext) return setError("Use a JPG, PNG or WebP image.");
    if (file.size > MAX_BYTES) return setError("Photos must be 5 MB or smaller.");

    startTransition(async () => {
      const path = `${userId}/${Date.now()}.${ext}`;
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage.from("instructor-photos").upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) return setError("Upload failed. Please try again.");
      const result = await setInstructorPhoto(path);
      if (result.error) return setError(result.error);
      setPreview(URL.createObjectURL(file));
    });
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
        {preview ? (
          <Image src={preview} alt={`Photo of ${firstName}`} fill sizes="96px" className="object-cover" unoptimized />
        ) : (
          <span className="flex h-full items-center justify-center text-xs text-slate-400">No photo</span>
        )}
      </div>
      <div>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => input.current?.click()}>
          {pending ? "Uploading…" : preview ? "Change photo" : "Upload photo"}
        </button>
        <p className="mt-1 text-xs text-slate-500">A friendly, clear photo of your face. Families see this when choosing an instructor.</p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      </div>
    </div>
  );
}
