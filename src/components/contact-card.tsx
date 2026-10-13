export type ContactPerson = { name: string; email: string | null; phone: string | null; detail?: string };

const prettyPhone = (e164: string) => {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

export function ContactCard({ title, people, note }: { title: string; people: ContactPerson[]; note?: string }) {
  if (!people.length) return null;
  return (
    <div className="card">
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-2 divide-y divide-stone-100">
        {people.map((p) => (
          <li key={`${p.name}-${p.email}`} className="py-2 text-sm">
            <p className="font-medium">{p.name}</p>
            {p.detail && <p className="text-xs text-stone-500">{p.detail}</p>}
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {p.phone && (
                <a className="text-brand-700 underline" href={`tel:${p.phone}`}>
                  {prettyPhone(p.phone)}
                </a>
              )}
              {p.phone && (
                <a className="text-brand-700 underline" href={`sms:${p.phone}`}>
                  Text
                </a>
              )}
              {p.email && (
                <a className="text-brand-700 underline" href={`mailto:${p.email}`}>
                  {p.email}
                </a>
              )}
            </p>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-xs text-stone-500">{note}</p>}
    </div>
  );
}
