import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountsModule } from './accounts/accounts.module';

import { Log4jsModule } from './log4js';
import configuration from './config/configuration';
import { Grid } from './entities/grid.entity';
import { User } from './entities/user.entity';
import { FuturesModule } from './futures/futures.module';
import { Token } from './entities/token.entity';

@Module({
  imports: [
    Log4jsModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        if (configService.get('db.type') == "mysql") {
          return {
            type: 'mysql',
            host: configService.get('db.host') || '127.0.0.1',
            port: configService.get('db.port') || 3306,
            username: configService.get('db.username'),
            password: configService.get('db.password'),
            database: configService.get('db.database'),
            entities: [User, Grid, Token],
            synchronize: true,
          }
        } else {
          return {
            type: 'sqlite',
            database: `${configService.get('db.database')}.db`,
            autoLoadEntities: true,
            synchronize: true,
          }
        }
      }
    }),
    FuturesModule,
    AccountsModule,
    ScheduleModule.forRoot(),
  ],
  providers: []
  // 
  
})
export class AppModule { }
