import pc from 'picocolors';

const VERSION = '0.1.0';

const LOGO = [
  '  ██████╗  █████╗      █████╗  ██████╗ ███████╗███╗   ██╗████████╗',
  ' ██╔═══██╗██╔══██╗    ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝',
  ' ██║   ██║███████║    ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ',
  ' ██║▄▄ ██║██╔══██║    ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ',
  ' ╚██████╔╝██║  ██║    ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ',
  '  ╚══▀▀═╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ',
];

const TAGLINE = 'Autonomous Full-Stack QA  ·  Developer  ·  Tester  ·  Self-Healing Debugger';
const BORDER = '─'.repeat(70);

export function printBanner(): void {
  console.log('');
  console.log(pc.dim(BORDER));
  for (const line of LOGO) {
    console.log(pc.cyan(pc.bold(line)));
  }
  console.log('');
  console.log(pc.bold(pc.white('  ' + TAGLINE)));
  console.log(pc.dim(`  v${VERSION}`));
  console.log(pc.dim(BORDER));
  console.log('');
}

export function printPhaseHeader(phase: string, description: string): void {
  const label = pc.bgCyan(pc.black(pc.bold(` ${phase} `)));
  console.log('');
  console.log(`${label}  ${pc.bold(pc.white(description))}`);
  console.log(pc.dim('─'.repeat(60)));
}

export function printSuccess(message: string): void {
  console.log(`${pc.green('✔')}  ${pc.green(pc.bold(message))}`);
}

export function printWarning(message: string): void {
  console.log(`${pc.yellow('⚠')}  ${pc.yellow(message)}`);
}

export function printError(message: string): void {
  console.log(`${pc.red('✖')}  ${pc.red(pc.bold(message))}`);
}

export function printInfo(message: string): void {
  console.log(`${pc.blue('ℹ')}  ${pc.white(message)}`);
}

export function printDim(message: string): void {
  console.log(pc.dim(`    ${message}`));
}

export function printSection(title: string): void {
  console.log('');
  console.log(pc.bold(pc.magenta(`▸ ${title}`)));
}
