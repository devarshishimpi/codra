import { Button } from "@codraoss/ui";
import { Link } from "react-router-dom";
import { Ghost, Home, ArrowLeft } from "lucide-react";

export function NotFoundPage() {
  return (
    <div className="min-h-svh flex flex-col items-center justify-center bg-background p-6">
      <div className="relative text-center max-w-md animate-fade-up">
        <div className="absolute inset-0 -z-10 bg-primary/5 blur-[100px] rounded-full" />

        <div className="relative mb-8 inline-flex items-center justify-center">
          <div className="absolute inset-0 animate-ping opacity-20 text-primary">
            <Ghost size={80} />
          </div>
          <div className="relative text-primary">
            <Ghost size={80} strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-6xl font-black tracking-tighter text-foreground mb-2">
          404
        </h1>
        <h2 className="text-xl font-bold text-foreground mb-4 uppercase tracking-widest">
          Resource not found
        </h2>

        <p className="text-muted-foreground leading-relaxed mb-10">
          The coordinates you're looking for don't exist in our current index.
          It may have been moved, deleted, or never existed in this dimension.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="outline"
            className="gap-2 font-bold px-6"
            onClick={() => window.history.back()}
          >
            <ArrowLeft size={16} /> Go Back
          </Button>
          <Link to="/">
            <Button className="gap-2 font-bold px-6 w-full sm:w-auto">
              <Home size={16} /> Return Home
            </Button>
          </Link>
        </div>

        <div className="mt-16 pt-8 border-t border-border/40">
          <p className="text-[10px] font-mono text-muted-foreground/50 uppercase tracking-[0.2em]">
            Error Code: ERR_OBJECT_NOT_FOUND_404
          </p>
        </div>
      </div>
    </div>
  );
}
