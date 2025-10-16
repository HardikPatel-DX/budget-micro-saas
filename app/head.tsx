// app/head.tsx
export default function Head() {
  const GA = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      {GA ? (
        <>
          <script async src={`https://www.googletagmanager.com/gtag/js?id=${GA}`}></script>
          <script
            dangerouslySetInnerHTML={{
              __html: `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA}', { page_path: window.location.pathname });
`
            }}
          />
        </>
      ) : null}
    </>
  );
}
