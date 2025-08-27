export default function EventsList({ events }) {
  if (!events?.length) return <p>No events available.</p>;
  return (
    <ul>
      {events.map(ev => (
        <li key={ev.id} style={{ marginBottom: 8 }}>
          <strong>{ev.title}</strong> — {
            new Date(ev.start || ev.date || "").toString() === "Invalid Date"
              ? "Date TBC"
              : new Date(ev.start || ev.date).toLocaleString()
          }
          {ev.url ? <> — <a href={ev.url} target="_blank" rel="noreferrer">Buy</a></> : null}
        </li>
      ))}
    </ul>
  );
}


