import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

// Stable identity: ReactMarkdown re-runs its plugin pipeline whenever `rehypePlugins` changes reference.
export const safeRehypePlugins = [rehypeRaw, rehypeSanitize];
