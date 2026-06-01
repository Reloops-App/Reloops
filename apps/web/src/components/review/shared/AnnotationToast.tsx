import { motion, AnimatePresence } from "framer-motion";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { fmtHMSF } from "@/lib/utils";
import { MentionDisplayDiv } from "@/components/ui/mention-display";
import { getAvatarInitials, AVATAR_FALLBACK_CLASS } from "@/lib/avatar-utils";

type Props = {
  show: boolean;
  author?: string;
  time?: number;
  text: string;
  emoji?: Record<string, number>;
};

export default function AnnotationToast({ show, author, time, text, emoji }: Props) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 8, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="absolute bottom-12 left-1/2 w-[320px] max-w-[84%] -translate-x-1/2 sm:bottom-16 sm:w-[500px] sm:max-w-[92%]"
        >
          <div className="flex items-start gap-2 rounded-2xl bg-background/95 p-2.5 text-foreground shadow-lg ring-1 ring-border sm:gap-3 sm:p-3">
            <Avatar className="h-7 w-7 sm:h-8 sm:w-8">
              <AvatarImage src="" alt="" />
              <AvatarFallback className={AVATAR_FALLBACK_CLASS}>{getAvatarInitials(author ?? "Comment")}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1 text-xs sm:text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="max-w-[100px] overflow-hidden text-ellipsis whitespace-nowrap font-medium text-foreground sm:max-w-[150px]">{author ?? "Comment"}</span>
                {Number.isFinite(time) && (
                  <Badge variant="secondary" className="shrink-0 bg-yellow-300 px-1.5 py-0 text-[10px] text-black sm:text-xs">
                    {fmtHMSF(time || 0)}
                  </Badge>
                )}
              </div>
              <MentionDisplayDiv className="mt-1 line-clamp-2 break-all whitespace-pre-wrap break-words" text={text} />
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              {Object.entries(emoji ?? {}).map(([k, v]) => (
                <Badge key={k} variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] sm:text-xs">
                  <span>{k}</span>
                  <span className="tabular-nums">{v as number}</span>
                </Badge>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
