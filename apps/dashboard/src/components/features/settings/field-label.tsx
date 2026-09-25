// Split from settings-support so that module can stay a pure .ts helper for Fast Refresh.
export function FieldLabel({
  htmlFor,
  id,
  children,
}: {
  htmlFor: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      id={id}
      className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-ui-subtle"
    >
      {children}
    </label>
  );
}
