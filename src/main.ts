import { NestFactory } from '@nestjs/core';
import * as session from 'express-session';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

import * as CryptoJS from "crypto-js";

import { Log4jsLogger } from './log4js';

function initPasswork(passkey: string) {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (input: any) => {
    input = input.toString().trim();
    if (passkey != CryptoJS.MD5(input).toString()) {
      console.error("password error!");
      process.exit(1);
      return;
    }

    const key = Buffer.alloc(32);
    key.write(input);
    global.key = key.toString().trim();
  });
}

async function bootstrap() {
  initPasswork("8c84d475cabe46c1a83c92d20b615bbb");

  const app = await NestFactory.create(AppModule);
  app.enableCors({ credentials: true, origin: true });
  app.use(cookieParser());
  app.useLogger(app.get(Log4jsLogger));

  const configService = app.get(ConfigService);
  
  await app.listen(configService.get("port", "3000"));
  console.log(`app start port ${configService.get("port", "3000")}`,);
}
bootstrap();
