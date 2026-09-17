export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[35rem] flex-col justify-center gap-6 px-4 py-12">
      <div className="rounded-xl bg-[var(--color-surface)] p-6 shadow-sm">
        <span className="inline-flex items-center rounded-full bg-[var(--color-primary)] px-3 py-1 text-sm font-medium text-[var(--color-on-primary)]">
          Dolmuş Takip
        </span>
        <h1 className="mt-4 text-2xl font-semibold text-[var(--color-text)]">
          Şoför ve mal sahibi hesabı bir arada
        </h1>
        <p className="mt-2 text-base text-[var(--color-text-secondary)]">
          Şoförlerin günlük hasılatını ve mal sahibinin hesabını kolayca
          takip eden uygulama.
        </p>
        <p className="mt-4 text-base text-[var(--color-text-secondary)]">
          Giriş ekranı yakında burada olacak.
        </p>
      </div>
    </main>
  );
}
