const express = require('express')
const path = require('path')

const app = express()

const publicDir = path.join(__dirname, '../public')
const distDir = path.join(__dirname, '../dist')

console.log({ publicDir, distDir })

// Serve files from the public directory first
app.use(express.static(publicDir, { maxAge: 2_000 }))

// Serve files from the dist directory if not found in public
app.use(express.static(distDir, { maxAge: 1_000 }))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`)
})
