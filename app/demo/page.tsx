'use client';
import TryDemoButton from '../../components/TryDemoButton';

export default function DemoPage() {
  return (
    <main className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-4">Try Budget Micro SaaS — Demo</h1>
      <p className="mb-4 text-gray-700">
        Welcome! Click the button below to seed a small set of demo transactions into your account.
        This is safe and intended to help you explore the app quickly.
      </p>

      <div className="mb-6">
        <TryDemoButton />
      </div>

      <section className="text-sm text-gray-600">
        <h2 className="font-semibold">What happens</h2>
        <ul className="list-disc ml-5">
          <li>10 demo transactions are inserted into your staging import table.</li>
          <li>The import pipeline will convert them into transactions you can view & edit.</li>
          <li>These rows are safe and intended for demo/testing purposes.</li>
        </ul>
      </section>
    </main>
  );
}
