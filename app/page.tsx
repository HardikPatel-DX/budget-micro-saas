export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", padding: "0 16px", fontFamily: "system-ui, Arial" }}>
      <h1 style={{ marginBottom: 8 }}>Budget Micro SaaS</h1>
      <p style={{ marginTop: 0, color: "#444" }}>
        Use the links below.
      </p>

      <ul style={{ lineHeight: 1.9 }}>
        <li>
          <a href="/dashboard">Dashboard</a>
        </li>
        <li>
          <a href="/upload">Upload (CSV)</a>
        </li>
      </ul>
    </main>
  );
}
