module.exports = {
  // if the app is supposed to run on Github Pages in a subfolder, use the following config:
  // publicPath: process.env.NODE_ENV === "production" ? "/townsquare/" : "/"
  publicPath: process.env.NODE_ENV === "production" ? "/" : "/",
  devServer: {
    allowedHosts: "all", // accept the trycloudflare.com hostname
    proxy: {
      "/voice": {
        target: "http://localhost:8090",
        ws: true,
        pathRewrite: { "^/voice": "" }
      },
      "/session": {
        target: "http://localhost:8081",
        ws: true,
        pathRewrite: { "^/session": "" }
      }
    }
  }
};
