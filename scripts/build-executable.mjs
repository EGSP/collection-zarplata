import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Сборка исполняемого файла поддерживается на Windows x64');
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(projectRoot, 'dist', 'executable');
const outputPath = path.join(outputDirectory, 'collection-zarplata.exe');
mkdirSync(outputDirectory, { recursive: true });

await build({
    entryPoints: [path.join(projectRoot, 'scripts', 'executable-entry.cjs')],
    outfile: path.join(outputDirectory, 'application.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    define: { 'import.meta.dirname': JSON.stringify('') },
    // При упаковке в одну область видимости esbuild переименовывает совпадающие имена классов,
    // например MetadataService в MetadataService2. Nest подписывает сообщения по имени класса,
    // поэтому исходные имена нужно сохранить.
    keepNames: true,
    plugins: [{
        name: 'turso-native-loader',
        setup(buildContext) {
            buildContext.onLoad({ filter: /@tursodatabase[\\/]database[\\/]index\.js$/ }, (argumentsValue) => {
                const source = readFileSync(argumentsValue.path, 'utf8');
                if (!source.includes('createRequire(import.meta.url)')
                    || !source.includes('nativeBinding = require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);')) {
                    throw new Error('Загрузчик нативного модуля Turso изменился; проверьте упаковку заново');
                }
                return { contents: source
                    .replace('createRequire(import.meta.url)', 'createRequire(process.execPath)')
                    .replace("new URL('.', import.meta.url).pathname", "require('node:path').dirname(process.execPath)")
                    .replace('nativeBinding = require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);',
                        'return require(process.env.NAPI_RS_NATIVE_LIBRARY_PATH);'),
                loader: 'js' };
            });
        },
    }],
    external: [
        '@nestjs/microservices', '@nestjs/platform-express', '@nestjs/websockets',
        '@fastify/multipart', '@fastify/view', 'class-validator', 'class-transformer',
    ],
});

const assets = {
    'turso.node': path.join(projectRoot, 'node_modules', '@tursodatabase', 'database-win32-x64-msvc', 'turso.win32-x64-msvc.node'),
};
// Клиент и сайт документации встраиваются одинаково: каждый файл становится ресурсом,
// имя которого начинается с имени каталога сборки.
function addSiteFiles(prefix, root, directory = root) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const filePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            addSiteFiles(prefix, root, filePath);
        } else if (entry.isFile()) {
            assets[`${prefix}/${path.relative(root, filePath).replaceAll('\\', '/')}`] = filePath;
        }
    }
}
addSiteFiles('web', path.join(projectRoot, 'dist', 'web'));
addSiteFiles('docs', path.join(projectRoot, 'dist', 'docs'));

const seaConfigurationPath = path.join(outputDirectory, 'sea.json');
const blobPath = path.join(outputDirectory, 'application.blob');
writeFileSync(seaConfigurationPath, JSON.stringify({
    main: path.join(outputDirectory, 'application.cjs'),
    output: blobPath,
    disableExperimentalSEAWarning: true,
    assets,
}));

execFileSync(process.execPath, ['--experimental-sea-config', seaConfigurationPath], { stdio: 'inherit' });
copyFileSync(process.execPath, outputPath);
await inject(outputPath, 'NODE_SEA_BLOB', readFileSync(blobPath), {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});
console.log(`Исполняемый файл: ${outputPath}`);
