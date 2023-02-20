import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

// export type GridType ="SUBMITTING"|"COMPLETED";

export enum GridStatus {
  SUBMITTING = "SUBMITTING",
  COMPLETED = "COMPLETED",
  STOPED = "STOPED",
};

@Entity()
export class Grid {

  @PrimaryGeneratedColumn()
  id: number

  @Column()
  userId: number

  @Column()
  contract: string

  @Column()
  topPrice: string

  @Column()
  buyPrice: string

  @Column()
  closePrice: string

  @Column()
  priceRound: string

  @Column()
  totalSize: number

  @Column()
  gridNum: number

  @Column()
  status: GridStatus
}