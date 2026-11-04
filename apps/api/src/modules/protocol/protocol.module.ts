import { Module } from '@nestjs/common';
import { ProtocolController } from './protocol.controller';

@Module({
  controllers: [ProtocolController],
})
export class ProtocolModule {}
