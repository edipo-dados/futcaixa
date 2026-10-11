/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Build "standalone": o Next empacota só o necessário para rodar em produção
  // (server mínimo + deps usadas), reduzindo o tamanho da imagem e acelerando o
  // boot no Render (importante no Free, que faz cold start após 15 min ocioso).
  output: "standalone",
};

export default nextConfig;
